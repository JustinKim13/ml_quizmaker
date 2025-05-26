import re
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

class DistractorGenerator:
    def generate_distractors(self, question, answer, context):
        """Generate distractors for a multiple choice question."""
        try:
            # Clean and normalize the answer
            clean_answer = self.clean_answer(answer)
            if not clean_answer:
                raise ValueError("Empty answer after cleaning")

            # Try to find the answer in the vocabulary
            answer_sense = None
            try:
                answer_sense = self.find_answer_sense(clean_answer)
            except Exception as e:
                logger.error(f"Error finding answer sense: {str(e)}")
                # Fallback to using the raw answer if sense not found
                answer_sense = clean_answer

            # Generate distractors using MMR
            try:
                distractors = self.generate_distractors_mmr(answer_sense, context)
                if not distractors or len(distractors) < 3:
                    # Fallback to simple distractors if MMR fails
                    distractors = self.generate_simple_distractors(answer_sense, context)
            except Exception as e:
                logger.error(f"Error in MMR distractor generation: {str(e)}")
                distractors = self.generate_simple_distractors(answer_sense, context)

            # Ensure we have enough distractors
            if not distractors or len(distractors) < 3:
                raise ValueError(f"Not enough distractors generated: {distractors}")

            return distractors[:3]  # Return only the top 3 distractors

        except Exception as e:
            logger.error(f"Failed to generate multiple choice question: {str(e)}")
            logger.error(f"Question: {question}")
            logger.error(f"Answer: {answer}")
            logger.error(f"Context: {context[:200]}...")
            raise

    def generate_simple_distractors(self, answer, context):
        """Generate simple distractors when MMR fails."""
        try:
            # Extract key terms from context
            doc = self.nlp(context)
            key_terms = [token.text for token in doc if token.pos_ in ['NOUN', 'PROPN', 'ADJ']]
            
            # Filter out terms too similar to the answer
            filtered_terms = [term for term in key_terms if term.lower() != answer.lower()]
            
            # Get embeddings for filtered terms
            term_embeddings = self.sentence_transformer.encode(filtered_terms)
            answer_embedding = self.sentence_transformer.encode([answer])[0]
            
            # Calculate similarities and select most different terms
            similarities = cosine_similarity([answer_embedding], term_embeddings)[0]
            most_different_indices = np.argsort(similarities)[:3]
            
            return [filtered_terms[i] for i in most_different_indices]
        except Exception as e:
            logger.error(f"Error in simple distractor generation: {str(e)}")
            return []

    def clean_answer(self, answer):
        """Clean and normalize the answer text."""
        try:
            # Remove special characters and extra whitespace
            cleaned = re.sub(r'[^\w\s]', '', answer)
            cleaned = ' '.join(cleaned.split())
            
            # Convert to lowercase
            cleaned = cleaned.lower()
            
            # Remove common prefixes/suffixes
            prefixes = ['the', 'a', 'an']
            for prefix in prefixes:
                if cleaned.startswith(prefix + ' '):
                    cleaned = cleaned[len(prefix)+1:]
            
            return cleaned.strip()
        except Exception as e:
            logger.error(f"Error cleaning answer: {str(e)}")
            return answer 