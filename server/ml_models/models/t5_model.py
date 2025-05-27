from transformers import T5ForConditionalGeneration, T5TokenizerFast, pipeline, AutoTokenizer, AutoModelForQuestionAnswering
import torch
import json
import random
from distractor_generator import create_multiple_choice
import datetime
from pathlib import Path
from typing import Dict, List
import gc
import re
import argparse
import traceback
import logging
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '../data_preprocessing'))
from s3_utils import write_json_to_s3, read_json_from_s3

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Global variables
MODEL_CACHE = {}
NUM_QUESTIONS = 5  # Default number of questions

def get_model(model_name: str):
    """Cache and return models to prevent reloading."""
    if model_name not in MODEL_CACHE:
        if 't5' in model_name.lower():
            MODEL_CACHE[model_name] = (
                T5ForConditionalGeneration.from_pretrained(model_name).eval(),
                T5TokenizerFast.from_pretrained(model_name)
            )
        else:
            MODEL_CACHE[model_name] = (
                AutoModelForQuestionAnswering.from_pretrained(model_name).eval(),
                AutoTokenizer.from_pretrained(model_name)
            )
    return MODEL_CACHE[model_name]

def update_status(status_data: Dict):
    """Update status file in S3 with current state."""
    try:
        # Always include timestamp
        status_data = {**status_data, "timestamp": str(datetime.datetime.now())}
        # Use the same path as the server
        write_json_to_s3(status_data, 'status/status.json')
    except Exception as e:
        logger.error(f"Failed to update status: {str(e)}")
        raise

def check_game_status(game_code: str) -> bool:
    """Check if game still exists and is active."""
    try:
        status_file = read_json_from_s3('status/status.json')
        if not status_file:
            logger.info(f"Game {game_code} no longer exists, stopping question generation")
            return False
            
        # Check if the game status indicates it's still active
        if status_file.get('status') == 'error' or status_file.get('status') == 'completed':
            logger.info(f"Game {game_code} is no longer active (status: {status_file.get('status')}), stopping question generation")
            return False
            
        return True
    except Exception as e:
        logger.error(f"Error checking game status: {str(e)}")
        return False

def clean_context(context: str) -> str:
    """Clean the input context."""
    return "".join(context).replace("▁", " ").replace("", "").strip() if isinstance(context, list) else context.strip()

@torch.no_grad()  # Disable gradient calculations for inference
def generate_question(context: str, model, tokenizer, max_length: int = 512) -> str:
    """Generate a question using T5 model."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    inputs = tokenizer(
        f"generate question: {context}",
        return_tensors="pt",
        max_length=max_length,
        truncation=True,
        padding="max_length"
    ).to(device)

    outputs = model.generate(
        input_ids=inputs.input_ids,
        attention_mask=inputs.attention_mask,
        max_length=64,  # Shorter max_length for more focused questions
        num_beams=4,
        length_penalty=1.0,
        early_stopping=True,
        no_repeat_ngram_size=2  # Prevent repetition
    )
    
    return tokenizer.decode(outputs[0], skip_special_tokens=True).strip()

def extract_best_answer(question: str, context: str, qa_pipeline, max_context_length: int = 384) -> tuple:
    """Extract the best possible answer."""
    try:
        truncated_context = context[:max_context_length]
        results = qa_pipeline(question=question, context=truncated_context, top_k=3, max_answer_len=50)
        
        if results:
            best_result = max(results, key=lambda x: x.get("score", 0.0))
            return best_result.get("answer", "No answer found"), best_result.get("score", 0.0)
        return "No valid answers found", 0.0
    except Exception as e:
        print(f"Error extracting answer: {str(e)}")
        return f"Error extracting answer: {str(e)}", 0.0

def load_and_tokenize_text(input_file: str, min_paragraph_length: int = 200, max_paragraph_length: int = 1000) -> List[str]:
    """Load and split text by paragraphs for more natural chunking."""
    try:
        with open(input_file, "r", encoding="utf-8") as file:
            text = file.read()
            
        print(f"Loaded text with {len(text)} characters")
        
        # Clean up formatting artifacts
        # Remove page headers/footers and other formatting artifacts
        text = re.sub(r'\d+\s+Science\s+\d+-\d+\s+Ch\d+\.qxd\s+\d+/\d+/\d+\s+\d+:\d+\s+Page\s+\d+', '', text)
        
        # Split text into paragraphs
        paragraphs = re.split(r'\n\s*\n', text)
        
        # Filter out short paragraphs, page numbers, and other artifacts
        valid_paragraphs = []
        for p in paragraphs:
            p = p.strip()
            # Skip short paragraphs
            if len(p) < min_paragraph_length:
                continue
                
            # Skip paragraphs that are likely page numbers or headers
            if re.match(r'^\d+$', p) or re.match(r'^Chapter \d+', p):
                continue
                
            # Skip paragraphs with too many numbers or special characters
            if sum(c.isdigit() or c in '/:.-' for c in p) / len(p) > 0.3:
                continue
            
            # If paragraph is too long, split it into smaller chunks
            if len(p) > max_paragraph_length:
                # Try to split on sentences
                sentences = re.split(r'(?<=[.!?])\s+', p)
                current_chunk = ""
                
                for sentence in sentences:
                    if len(current_chunk) + len(sentence) <= max_paragraph_length:
                        current_chunk += sentence + " "
                    else:
                        if current_chunk:
                            valid_paragraphs.append(current_chunk.strip())
                        current_chunk = sentence + " "
                
                # Add the last chunk if it exists
                if current_chunk and len(current_chunk) >= min_paragraph_length:
                    valid_paragraphs.append(current_chunk.strip())
            else:
                valid_paragraphs.append(p)
        
        print(f"Split text into {len(valid_paragraphs)} paragraphs")
        return valid_paragraphs
    except Exception as e:
        print(f"Error loading text: {str(e)}")
        traceback.print_exc()
        return []

@torch.no_grad()
def process_chunk(chunk: str, models: Dict) -> Dict:
    """Process a single chunk to generate a QA pair."""
    try:
        context = clean_context(chunk)
        
        # Skip chunks that are too short
        if len(context) < 200:
            raise ValueError(f"Chunk too short: {len(context)} characters")
            
        question = generate_question(context, models['qg_model'], models['qg_tokenizer'])
        
        # Skip if question is too short or invalid
        if not question or len(question) < 10:
            raise ValueError(f"Generated invalid question: {question}")
            
        print(f"Generated question: {question}")

        best_answer, score = extract_best_answer(question, context, models['qa_pipeline'])
        print(f"Generated answer: {best_answer} (confidence: {score:.2f})")

        if score < 0.3:
            raise ValueError(f"Answer confidence too low: {score:.2f}")
            
        if not best_answer:
            raise ValueError("No answer found")
            
        if len(best_answer.split()) > 10:
            raise ValueError(f"Answer too long: {len(best_answer.split())} words")
            
        try:
            mc_question = create_multiple_choice(question, best_answer, context)
            if not mc_question:
                raise ValueError("Failed to create multiple choice question")
                
            if 'options' not in mc_question:
                raise ValueError("Multiple choice question missing options")
                
            if len(mc_question['options']) < 3:
                raise ValueError(f"Not enough options: {len(mc_question['options'])}")
                
            # Highlight the answer in the context
            highlighted_context = context
            if best_answer in highlighted_context:
                highlighted_context = highlighted_context.replace(
                    best_answer, 
                    f"**{best_answer}**"  # Bold the answer in the context
                )
            
            return {
                "question": mc_question['question'],
                "options": mc_question['options'],
                "correct_answer": mc_question['answer'],
                "context": highlighted_context[:1500],  # Include more context with highlighting
                "answer_confidence": float(score)
            }
        except Exception as e:
            logger.error(f"Error generating distractors: {str(e)}")
            logger.error(f"Question: {question}")
            logger.error(f"Answer: {best_answer}")
            logger.error(f"Context: {context[:200]}...")  # Log first 200 chars of context
            raise ValueError(f"Failed to create multiple choice question: {str(e)}")
            
    except Exception as e:
        logger.error(f"Error in process_chunk: {str(e)}")
        logger.error(f"Chunk: {chunk[:200]}...")  # Log first 200 chars of chunk
        raise ValueError(f"Failed to process chunk: {str(e)}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--num_questions', type=int, default=10)
    parser.add_argument('--game_code', type=str, required=True)
    args = parser.parse_args()
    
    paths = {
        'input': "ml_models/outputs/combined_output.txt",
        'chunks': "ml_models/data_preprocessing/tokenized_chunks.json",
        'output': "ml_models/models/questions.json"
    }
    
    try:
        # Set up logging
        logging.basicConfig(level=logging.DEBUG)
        logger = logging.getLogger(__name__)
        
        # Clear any existing status before starting
        update_status({
            "status": "processing", 
            "message": "Starting question generation...",
            "progress": 0,
            "total_questions": args.num_questions,
            "questions_generated": 0
        })
        
        logger.info("Starting question generation process")
        update_status({
            "status": "processing", 
            "message": "Loading models...",
            "progress": 0,
            "total_questions": args.num_questions,
            "questions_generated": 0
        })

        # Load models with CUDA optimization
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info(f"Using device: {device}")
        
        try:
            logger.info("Loading T5 model...")
            qg_model, qg_tokenizer = get_model("valhalla/t5-base-qg-hl")
            qg_model = qg_model.to(device)
            logger.info("Successfully loaded T5 model")
        except Exception as e:
            logger.error(f"Failed to load T5 model: {str(e)}")
            raise

        try:
            logger.info("Loading RoBERTa model...")
            qa_pipeline = pipeline("question-answering", 
                                 model="deepset/roberta-base-squad2",
                                 device=0 if torch.cuda.is_available() else -1)
            logger.info("Successfully loaded RoBERTa model")
        except Exception as e:
            logger.error(f"Failed to load RoBERTa model: {str(e)}")
            raise

        models = {
            'qg_model': qg_model,
            'qg_tokenizer': qg_tokenizer,
            'qa_pipeline': qa_pipeline
        }

        update_status({
            "status": "processing", 
            "message": "Processing text chunks...",
            "progress": 10,
            "total_questions": args.num_questions,
            "questions_generated": 0
        })
        
        logger.info("Loading and tokenizing text...")
        chunks = load_and_tokenize_text(paths['input'])
        logger.info(f"Loaded {len(chunks)} text chunks")
        
        # Save chunks for debugging
        with open(paths['chunks'], "w", encoding="utf-8") as f:
            json.dump(chunks[:50], f)  # Save first 50 chunks to avoid huge files

        update_status({
            "status": "processing", 
            "message": "Starting question generation...",
            "progress": 20,
            "total_questions": args.num_questions,
            "questions_generated": 0
        })

        qa_pairs = []
        random.shuffle(chunks)  # Randomize to get diverse questions
        
        # Process more chunks to get more questions
        max_chunks_to_process = min(100, len(chunks))
        logger.info(f"Processing up to {max_chunks_to_process} chunks to generate {args.num_questions} questions")
        
        for i, chunk in enumerate(chunks[:max_chunks_to_process]):
            # Check if game still exists before processing each chunk
            if not check_game_status(args.game_code):
                return

            if len(qa_pairs) >= args.num_questions:
                break
                
            logger.info(f"Processing chunk {i+1}/{max_chunks_to_process}")
            try:
                qa_pair = process_chunk(chunk, models)
                if qa_pair:
                    qa_pairs.append(qa_pair)
                    logger.info(f"Created multiple choice question {len(qa_pairs)} of {args.num_questions}")
                    
                    # Update status after each successful question
                    progress = min(100, 20 + (len(qa_pairs) / args.num_questions * 70))  # 20-90% range for question generation
                    update_status({
                        "status": "processing", 
                        "message": f"Generated {len(qa_pairs)} of {args.num_questions} questions...",
                        "progress": int(progress),
                        "total_questions": args.num_questions,
                        "questions_generated": len(qa_pairs)
                    })
            except Exception as e:
                logger.error(f"Failed to process chunk {i+1}: {str(e)}")
                continue

        if not qa_pairs:
            raise ValueError("No questions were generated successfully")

        # Save questions with context to file
        logger.info(f"Saving {len(qa_pairs)} questions to {paths['output']}")
        with open(paths['output'], "w", encoding="utf-8") as f:
            json.dump({"questions": qa_pairs}, f, indent=2)

        # Upload questions to S3 so the backend can access them
        write_json_to_s3({"questions": qa_pairs}, 'questions/questions.json')

        # Clear CUDA cache
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        gc.collect()

        update_status({
            "status": "completed",
            "message": f"Successfully generated {len(qa_pairs)} questions",
            "progress": 100,
            "total_questions": args.num_questions,
            "questions_generated": len(qa_pairs)
        })
        logger.info("Question generation completed successfully")

    except Exception as e:
        logger.error(f"An error occurred: {str(e)}")
        traceback.print_exc()  # Print full traceback for debugging
        update_status({
            "status": "error",
            "message": f"Error: {str(e)}",
            "progress": 0,
            "total_questions": args.num_questions,
            "questions_generated": 0
        })
        raise  # Re-raise the exception to ensure the process fails

if __name__ == "__main__":
    main()