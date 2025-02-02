import os
from sense2vec import Sense2Vec
from sentence_transformers import SentenceTransformer
from typing import List, Dict
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

# Load models
s2v_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../s2v_old"))
s2v = Sense2Vec().from_disk(s2v_path)
model = SentenceTransformer('all-MiniLM-L12-v2')

def mmr(doc_embedding: np.ndarray,
        word_embeddings: np.ndarray,
        words: List[str],
        top_n: int = 5,
        diversity: float = 0.9) -> List[str]:
    """Calculate Maximal Marginal Relevance (MMR)."""
    word_doc_similarity = cosine_similarity(word_embeddings, doc_embedding)
    word_similarity = cosine_similarity(word_embeddings)

    keywords_idx = [np.argmax(word_doc_similarity)]
    candidates_idx = [i for i in range(len(words)) if i != keywords_idx[0]]

    for _ in range(top_n - 1):
        candidate_similarities = word_doc_similarity[candidates_idx, :]
        target_similarities = np.max(word_similarity[candidates_idx][:, keywords_idx], axis=1)

        mmr = (1-diversity) * candidate_similarities - diversity * target_similarities.reshape(-1, 1)
        mmr_idx = candidates_idx[np.argmax(mmr)]

        keywords_idx.append(mmr_idx)
        candidates_idx.remove(mmr_idx)

    return [words[idx] for idx in keywords_idx]

def create_multiple_choice(question: str, correct_answer: str, context: str) -> Dict:
    """Generate a multiple-choice question with distractors using sense2vec."""
    # Prepare the word for sense2vec
    word = correct_answer.lower().replace(" ", "_")
    
    try:
        # Get the best sense and similar words
        sense = s2v.get_best_sense(word)
        most_similar = s2v.most_similar(sense, n=20)
        
        # Extract distractors
        distractors = []
        for each_word in most_similar:
            append_word = each_word[0].split("|")[0].replace("_", " ")
            if append_word not in distractors and append_word != correct_answer:
                distractors.append(append_word)
        
        if not distractors:
            return {
                "question": question,
                "options": [correct_answer] + [f"Option {i+1}" for i in range(3)],
                "answer": correct_answer
            }

        # Get embeddings
        all_options = [correct_answer] + distractors
        answer_embedding = model.encode([correct_answer])
        distractor_embeddings = model.encode(all_options)
        
        # Use MMR to get diverse options
        final_options = mmr(answer_embedding, distractor_embeddings, all_options, top_n=4)
        
        # First option will be the correct answer, rest are distractors
        options = [opt.title() for opt in final_options[:4]]  # Title case all options
        
        return {
            "question": question,
            "options": options,
            "answer": correct_answer
        }
        
    except Exception as e:
        # Fallback if sense2vec fails
        return {
            "question": question,
            "options": [correct_answer] + [f"Option {i+1}" for i in range(3)],
            "answer": correct_answer
        }