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
import difflib

# Global model cache
MODEL_CACHE = {}

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

def update_status(status_file: str, status_data: Dict):
    """Update status file with current state."""
    with open(status_file, "w", encoding="utf-8") as f:
        json.dump({**status_data, "timestamp": str(datetime.datetime.now())}, f)

def clean_context(context: str) -> str:
    """Clean the input context."""
    return "".join(context).replace("▁", " ").replace("", "").strip() if isinstance(context, list) else context.strip()

@torch.no_grad()
def generate_question(context: str, model, tokenizer, max_length: int = 512) -> str:
    """Generate a question using T5 model with improved prompting and filtering."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    # Improved prompt formatting
    prompt = f"generate question: {context}"
    
    inputs = tokenizer(
        prompt,
        return_tensors="pt",
        max_length=max_length,
        truncation=True,
        padding="max_length"
    ).to(device)

    # Increase num_beams for better question quality
    outputs = model.generate(
        input_ids=inputs.input_ids,
        attention_mask=inputs.attention_mask,
        max_length=64,  # Shorter max_length for more focused questions
        num_beams=5,    # Increased from 4
        length_penalty=1.5,  # Encourage slightly longer questions
        early_stopping=True,
        no_repeat_ngram_size=2,  # Prevent repetition
        do_sample=True,  # Enable sampling
        top_k=50,       # Filter top K tokens
        top_p=0.95      # Nucleus sampling
    )
    
    question = tokenizer.decode(outputs[0], skip_special_tokens=True).strip()
    
    # Basic question quality filters
    if not is_valid_question(question):
        return generate_question(context, model, tokenizer, max_length)  # Recursively try again
    
    return question

def is_valid_question(question: str) -> bool:
    """Check if the generated question meets quality criteria."""
    # Must start with question words
    question_starters = ['what', 'who', 'where', 'when', 'why', 'how', 'which']
    
    # Basic validation
    if not question or len(question.split()) < 4:  # Too short
        return False
    
    question_lower = question.lower()
    
    # Must start with a question word
    if not any(question_lower.startswith(starter) for starter in question_starters):
        return False
        
    # Check for common issues
    bad_patterns = [
        'what is what',
        'who is who',
        'where is where',
        'when is when',
        'of what',  # Often produces "capital of what country" style questions
    ]
    
    if any(pattern in question_lower for pattern in bad_patterns):
        return False
        
    return True

def extract_best_answer(question: str, context: str, qa_pipeline, max_context_length: int = 384) -> tuple:
    """Extract the best possible answer and its context span."""
    try:
        # Find the original question and answer in the context
        question_pattern = r"Trivia Question: (.*?)\? Answer: (.*?)(?=Trivia Question:|$)"
        matches = re.findall(question_pattern, context)
        
        # Find the most similar question to our generated question
        best_match = None
        best_similarity = 0
        for q, a in matches:
            similarity = difflib.SequenceMatcher(None, question.lower(), q.lower()).ratio()
            if similarity > best_similarity:
                best_similarity = similarity
                best_match = (q, a)
        
        if best_match and best_similarity > 0.6:  # Threshold for question similarity
            orig_question, answer = best_match
            
            # Find positions for highlighting
            question_start = context.find(f"Trivia Question: {orig_question}")
            question_end = question_start + len(f"Trivia Question: {orig_question}")
            answer_start = context.find(f"Answer: {answer}") + len("Answer: ")
            answer_end = answer_start + len(answer)
            
            # Create highlighted context
            highlighted_context = (
                context[:question_start] +
                "**Trivia Question: " + orig_question + "?**" +
                context[question_end:answer_start] +
                "**" + answer + "**" +
                context[answer_end:]
            )
            
            return answer.strip(), 0.9, highlighted_context
            
        # Fallback to the QA pipeline if no good match found
        truncated_context = context[:max_context_length]
        results = qa_pipeline(question=question, context=truncated_context, top_k=5, max_answer_len=50)
        
        if results:
            best_result = max(results, key=lambda x: x.get("score", 0.0))
            start_idx = best_result.get("start", 0)
            end_idx = best_result.get("end", 0)
            
            highlighted_context = (
                context[:start_idx] +
                "**" + context[start_idx:end_idx] + "**" +
                context[end_idx:]
            )
            
            return (
                best_result.get("answer", "No answer found"),
                best_result.get("score", 0.0),
                highlighted_context
            )
            
        return "No valid answers found", 0.0, context
    except Exception as e:
        print(f"[ERROR] Answer extraction failed: {str(e)}")
        return f"Error extracting answer: {str(e)}", 0.0, context

def load_and_tokenize_text(input_file: str, max_chunk_length: int = 512, overlap: int = 100) -> List[str]:
    """Load and chunk text efficiently."""
    with open(input_file, "r", encoding="utf-8") as file:
        text = " ".join(file.read().split())
    return [text[i:i + max_chunk_length] for i in range(0, len(text), max_chunk_length - overlap)]

@torch.no_grad()
def process_chunk(chunk: str, models: Dict) -> Dict:
    """Process a single chunk to generate a QA pair with improved filtering."""
    context = clean_context(chunk)
    
    # Extract existing Q&A pairs from the context
    qa_pairs = re.findall(r"Trivia Question: (.*?)\? Answer: (.*?)(?=Trivia Question:|$)", context)
    
    if not qa_pairs:
        return None
    
    # Select a random Q&A pair
    question, answer = random.choice(qa_pairs)
    question = question.strip()
    answer = answer.strip()
    
    print(f"Selected Q&A pair: {question} -> {answer}")
    
    try:
        mc_question = create_multiple_choice(question, answer, context)
        
        # Find and highlight the question and answer in the context
        q_start = context.find(f"Trivia Question: {question}")
        q_end = q_start + len(f"Trivia Question: {question}")
        a_start = context.find(f"Answer: {answer}")
        a_end = a_start + len(f"Answer: {answer}")
        
        highlighted_context = (
            context[:q_start] +
            "**Trivia Question: " + question + "?**" +
            context[q_end:a_start] +
            "**Answer: " + answer + "**" +
            context[a_end:]
        )
        
        return {
            "question": question,
            "options": mc_question['options'],
            "correct_answer": answer,
            "context": highlighted_context
        }
    except Exception as e:
        print(f"Error generating distractors: {str(e)}")
        return None

def is_answer_type_match(question: str, answer: str) -> bool:
    """Check if the answer type matches the question type."""
    question_lower = question.lower()
    answer_lower = answer.lower()
    
    # Check for question-answer type consistency
    if "what country" in question_lower:
        return not any(word in answer_lower for word in ["movie", "food", "drink", "year"])
    elif "what is the main ingredient" in question_lower:
        return not any(word in answer_lower for word in ["movie", "country", "year", "person"])
    elif "what movie" in question_lower:
        return not any(word in answer_lower for word in ["country", "food", "ingredient"])
    
    return True

def main():
    paths = {
        'input': "ml_models/outputs/combined_output.txt",
        'chunks': "ml_models/data_preprocessing/tokenized_chunks.json",
        'output': "ml_models/models/questions.json",
        'status': "ml_models/models/status.json"
    }
    
    try:
        update_status(paths['status'], {"status": "processing", "message": "Loading models..."})

        # Load models with CUDA optimization
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        qg_model, qg_tokenizer = get_model("valhalla/t5-base-qg-hl")
        qg_model = qg_model.to(device)

        qa_pipeline = pipeline("question-answering", 
                             model="deepset/roberta-base-squad2",
                             device=0 if torch.cuda.is_available() else -1)

        models = {
            'qg_model': qg_model,
            'qg_tokenizer': qg_tokenizer,
            'qa_pipeline': qa_pipeline
        }

        update_status(paths['status'], {"status": "processing", "message": "Processing text..."})
        chunks = load_and_tokenize_text(paths['input'])
        
        with open(paths['chunks'], "w", encoding="utf-8") as f:
            json.dump(chunks, f)

        update_status(paths['status'], {"status": "processing", "message": "Generating questions..."})

        qa_pairs = []
        random.shuffle(chunks)
        
        for chunk in chunks:
            if len(qa_pairs) >= 3:
                break
                
            print(f"\nProcessing chunk: {chunk[:100]}...")
            qa_pair = process_chunk(chunk, models)
            if qa_pair:
                qa_pairs.append(qa_pair)
                print(f"\nCreated multiple choice question {len(qa_pairs)} of 3:")
                print(json.dumps(qa_pair, indent=2))

        # Save questions with context to file
        with open(paths['output'], "w", encoding="utf-8") as f:
            json.dump({"questions": qa_pairs}, f, indent=2)

        # Clear CUDA cache
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        gc.collect()

        update_status(paths['status'], {
            "status": "completed",
            "questions_count": len(qa_pairs)
        })

    except Exception as e:
        print(f"An error occurred: {str(e)}")
        update_status(paths['status'], {
            "status": "error",
            "error": str(e)
        })

if __name__ == "__main__":
    main()
