from transformers import (
    T5ForConditionalGeneration,
    T5TokenizerFast,
    pipeline,
)
import torch
import os
import json
import random
from distractor_generator import create_multiple_choice  # Import from the separate distractor generator file
import datetime

# Clean context to remove tokenization artifacts
def clean_context(context):
    """
    Clean the input context by removing tokenization artifacts and ensuring plain text.
    """
    if isinstance(context, list):
        context = "".join(context)
    return context.replace("▁", " ").replace("", "").strip()

# Load T5 model and tokenizer for question generation
def load_qg_model_and_tokenizer(model_name="valhalla/t5-base-qg-hl"):
    """
    Load pre-trained T5 model and tokenizer for question generation.
    """
    tokenizer = T5TokenizerFast.from_pretrained(model_name)
    model = T5ForConditionalGeneration.from_pretrained(model_name)
    return model, tokenizer

# Generate a question using T5 model
def generate_question(context, model, tokenizer, max_length=512, num_beams=4):
    """
    Generate a question from the input context using T5 model.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    input_text = f"generate question: {context}"

    inputs = tokenizer(
        input_text,
        return_tensors="pt",
        max_length=max_length,
        truncation=True,
        padding="max_length",
    ).to(device)

    output_ids = model.generate(
        input_ids=inputs.input_ids,
        attention_mask=inputs.attention_mask,
        max_length=max_length,
        num_beams=num_beams,
    )

    question = tokenizer.decode(output_ids[0], skip_special_tokens=True).strip()
    return question

# Extract the best possible answer
def extract_best_answer(question, context, qa_pipeline, max_context_length=384):
    """
    Extract the best possible answer to a question from the given context using a QA pipeline.
    """
    try:
        truncated_context = context[:max_context_length] if len(context) > max_context_length else context

        results = qa_pipeline(question=question, context=truncated_context, top_k=3)  # Extract top 3 answers

        # Get the best answer (highest score)
        if results:
            best_result = max(results, key=lambda x: x.get("score", 0.0))
            return best_result.get("answer", "No answer found"), best_result.get("score", 0.0)
        return "No valid answers found", 0.0
    except Exception as e:
        return f"Error extracting answer: {str(e)}", 0.0

# Load and tokenize text
def load_and_tokenize_text(input_file, max_chunk_length=512, overlap=100):
    """
    Load, clean, chunk, and tokenize the text from the input file.
    """
    with open(input_file, "r", encoding="utf-8") as file:
        raw_text = file.read()

    # Clean and chunk the text
    text = " ".join(raw_text.split())  # Remove extra spaces
    chunks = [text[i:i + max_chunk_length] for i in range(0, len(text), max_chunk_length - overlap)]
    return chunks

# Save tokenized chunks to a file
def save_chunks(chunks, token_file):
    """
    Save text chunks to a file.
    """
    with open(token_file, "w", encoding="utf-8") as f:
        json.dump(chunks, f)

if __name__ == "__main__":
    # File paths
    input_file = "ml_models/outputs/combined_output.txt"
    tokenized_chunks_file = "ml_models/data_preprocessing/tokenized_chunks.json"
    output_file = "ml_models/outputs/generated_questions.json"  # New output file for questions

    # Model names
    question_generation_model_name = "valhalla/t5-base-qg-hl"  # Question generation model
    question_answering_model_name = "deepset/roberta-base-squad2"  # Fine-tuned QA model on SQuAD

    try:
        # Load models and tokenizers
        print("Loading models...")
        qg_model, qg_tokenizer = load_qg_model_and_tokenizer(question_generation_model_name)
        qa_pipeline = pipeline(
            "question-answering", 
            model=question_answering_model_name, 
            tokenizer=question_answering_model_name, 
            device=0 if torch.cuda.is_available() else -1
        )

        # Process raw text and save tokenized chunks
        print("Processing raw text...")
        chunks = load_and_tokenize_text(input_file, max_chunk_length=512, overlap=100)
        save_chunks(chunks, tokenized_chunks_file)

        # Initialize storage for QA pairs
        qa_pairs = []
        valid_qa_count = 0
        max_valid_qa = 10

        # Shuffle chunks for randomization
        random.shuffle(chunks)
        print(f"Generating {max_valid_qa} questions...")

        # Process chunks until we have enough valid questions
        for chunk in chunks:
            if valid_qa_count >= max_valid_qa:
                break

            # Clean and tokenize the chunk
            context = clean_context(chunk)
            question = generate_question(context, qg_model, qg_tokenizer)

            # Extract the best answer
            best_answer, score = extract_best_answer(question, context, qa_pipeline)

            # Store valid QA pair if score is above threshold
            if score >= 0.2:
                try:
                    # Create multiple-choice options
                    mc_question = create_multiple_choice(question, best_answer, context)
                    
                    # Store the QA pair
                    qa_pairs.append({
                        "id": valid_qa_count,  # Add an ID for easy reference
                        "question": mc_question['question'],
                        "options": mc_question['options'],
                        "correct_answer": mc_question['answer'],
                        "context": context,
                        "confidence_score": float(score)  # Convert to float for JSON serialization
                    })
                    
                    valid_qa_count += 1
                    print(f"Generated question {valid_qa_count}/{max_valid_qa}")
                    
                except Exception as e:
                    print(f"Error generating distractors: {str(e)}")
                    continue

        # Save all QA pairs to JSON file
        print(f"Saving {valid_qa_count} questions to {output_file}...")
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump({
                "metadata": {
                    "total_questions": valid_qa_count,
                    "generation_timestamp": str(datetime.datetime.now()),
                    "source_file": input_file
                },
                "questions": qa_pairs
            }, f, indent=2)
        
        print("Question generation completed successfully!")

    except Exception as e:
        print(f"An error occurred during question generation: {str(e)}")
        # Optionally, create an empty questions file to indicate completion
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump({
                "metadata": {
                    "error": str(e),
                    "generation_timestamp": str(datetime.datetime.now())
                },
                "questions": []
            }, f, indent=2)
        raise e
