def process_chunk(chunk, qg_model, qa_model, tokenizer, distractor_generator, device, min_confidence=0.3):
    """Process a single chunk of text to generate a question-answer pair."""
    try:
        # Generate question
        question = generate_question(chunk, qg_model, tokenizer, device)
        if not question:
            logger.error("Failed to generate question")
            return None

        # Generate answer
        answer, confidence = generate_answer(question, chunk, qa_model, tokenizer, device)
        if not answer or confidence < min_confidence:
            logger.error(f"Answer confidence too low: {confidence}")
            return None

        # Generate distractors
        try:
            distractors = distractor_generator.generate_distractors(question, answer, chunk)
            if not distractors or len(distractors) < 3:
                logger.error(f"Failed to generate enough distractors: {distractors}")
                return None
        except Exception as e:
            logger.error(f"Error generating distractors: {str(e)}")
            return None

        # Create multiple choice question
        try:
            mcq = create_multiple_choice_question(question, answer, distractors)
            if not mcq:
                logger.error("Failed to create multiple choice question")
                return None
            return mcq
        except Exception as e:
            logger.error(f"Error creating multiple choice question: {str(e)}")
            return None

    except Exception as e:
        logger.error(f"Error in process_chunk: {str(e)}")
        logger.error(f"Chunk: {chunk[:200]}...")
        return None

def main():
    """Main function to generate questions from text."""
    try:
        # ... existing code ...

        # Process chunks
        qa_pairs = []
        chunks_processed = 0
        max_chunks = min(100, len(chunks))  # Process up to 100 chunks

        for i, chunk in enumerate(chunks[:max_chunks]):
            logger.info(f"Processing chunk {i+1}/{max_chunks}")
            
            # Update status with progress
            progress = (i / max_chunks) * 100
            update_status(paths['status'], {
                "status": "processing",
                "message": f"Processing chunk {i+1}/{max_chunks}...",
                "progress": int(progress),
                "total_questions": args.num_questions,
                "questions_generated": len(qa_pairs)
            })

            # Process chunk with lower confidence threshold
            qa_pair = process_chunk(chunk, qg_model, qa_model, tokenizer, distractor_generator, device, min_confidence=0.3)
            
            if qa_pair:
                qa_pairs.append(qa_pair)
                logger.info(f"Created multiple choice question {len(qa_pairs)} of {args.num_questions}")
                
                # Update status with new question count
                update_status(paths['status'], {
                    "status": "processing",
                    "message": f"Generated {len(qa_pairs)} of {args.num_questions} questions...",
                    "progress": int(progress),
                    "total_questions": args.num_questions,
                    "questions_generated": len(qa_pairs)
                })

            if len(qa_pairs) >= args.num_questions:
                break

        # ... rest of existing code ...

    except Exception as e:
        logger.error(f"Error in main: {str(e)}")
        update_status(paths['status'], {
            "status": "error",
            "message": f"Error: {str(e)}",
            "timestamp": datetime.now().isoformat()
        })
        raise

# ... existing code ... 