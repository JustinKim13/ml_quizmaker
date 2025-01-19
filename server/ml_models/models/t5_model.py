from transformers import T5ForConditionalGeneration, T5TokenizerFast, pipeline, AutoTokenizer, AutoModelForQuestionAnswering
import torch
import json
import random
from distractor_generator import create_multiple_choice
import datetime
from pathlib import Path
from typing import Dict, List
import gc

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
        max_length=max_length,
        num_beams=4,
        early_stopping=True
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
        return f"Error extracting answer: {str(e)}", 0.0

def load_and_tokenize_text(input_file: str, max_chunk_length: int = 512, overlap: int = 100) -> List[str]:
    """Load and chunk text efficiently."""
    with open(input_file, "r", encoding="utf-8") as file:
        text = " ".join(file.read().split())
    return [text[i:i + max_chunk_length] for i in range(0, len(text), max_chunk_length - overlap)]

@torch.no_grad()
def process_chunk(chunk: str, models: Dict) -> Dict:
    """Process a single chunk to generate a QA pair."""
    context = clean_context(chunk)
    question = generate_question(context, models['qg_model'], models['qg_tokenizer'])
    print(f"Generated question: {question}")

    best_answer, score = extract_best_answer(question, context, models['qa_pipeline'])
    print(f"Generated answer: {best_answer} (confidence: {score})")

    if score >= 0.2:
        try:
            mc_question = create_multiple_choice(question, best_answer, context)
            return {
                "question": mc_question['question'],
                "options": mc_question['options'],
                "correct_answer": mc_question['answer'],
                "context": context  # Include the context here
            }
        except Exception as e:
            print(f"Error generating distractors: {str(e)}")
    return None

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
