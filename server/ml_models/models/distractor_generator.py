import os
from sense2vec import Sense2Vec
from sentence_transformers import SentenceTransformer
from typing import List, Dict
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
import random

# Load models
s2v_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "s2v_old"))

print(f"[DEBUG] Loading Sense2Vec model from: {s2v_path}")
s2v = Sense2Vec().from_disk(s2v_path)

print(f"[DEBUG] Total words in Sense2Vec model: {len(s2v)}")
print(f"[DEBUG] Sample words from vocab: {list(s2v.keys())[:10]}")

print("[DEBUG] Loading sentence transformer model...")
model = SentenceTransformer('all-MiniLM-L12-v2')
print("[DEBUG] Models loaded successfully.")

def mmr(doc_embedding: np.ndarray,
        word_embeddings: np.ndarray,
        words: List[str],
        top_n: int = 5,
        diversity: float = 0.9) -> List[str]:
    print(f"[DEBUG] Running MMR with top_n={top_n}, diversity={diversity}")
    word_doc_similarity = cosine_similarity(word_embeddings, doc_embedding)
    word_similarity = cosine_similarity(word_embeddings)

    print(f"[DEBUG] Word-document similarity shape: {word_doc_similarity.shape}")
    print(f"[DEBUG] Word-word similarity shape: {word_similarity.shape}")

    keywords_idx = [np.argmax(word_doc_similarity)]
    candidates_idx = [i for i in range(len(words)) if i != keywords_idx[0]]

    print(f"[DEBUG] Initial keyword index: {keywords_idx[0]} ({words[keywords_idx[0]]})")

    for _ in range(top_n - 1):
        candidate_similarities = word_doc_similarity[candidates_idx, :]
        target_similarities = np.max(word_similarity[candidates_idx][:, keywords_idx], axis=1)

        mmr_scores = (1 - diversity) * candidate_similarities - diversity * target_similarities.reshape(-1, 1)
        mmr_idx = candidates_idx[np.argmax(mmr_scores)]

        print(f"[DEBUG] Selected next keyword index: {mmr_idx} ({words[mmr_idx]})")

        keywords_idx.append(mmr_idx)
        candidates_idx.remove(mmr_idx)

    return [words[idx] for idx in keywords_idx]

def clean_answer_for_lookup(answer: str) -> str:
    words = answer.strip().split()
    if words[0].lower() in {"a", "an", "the"}:
        words = words[1:]
    return "_".join(words).lower()

def create_multiple_choice(question: str, correct_answer: str, context: str) -> Dict:
    print(f"\n[DEBUG] Generating MCQ for question: {question}")
    print(f"[DEBUG] Correct answer: {correct_answer}")

    lookup_word = clean_answer_for_lookup(correct_answer)
    print(f"[DEBUG] Sense2Vec lookup word: {lookup_word}")

    try:
        # Try to get best sense directly
        sense = None
        if lookup_word in s2v:
            sense = s2v.get_best_sense(lookup_word)
            print(f"[DEBUG] Best sense for word: {sense}")
        else:
            print(f"[WARNING] Word '{lookup_word}' not found in S2V. Searching for closest match...")
            matches = [key for key in s2v.keys() if lookup_word in key.lower()]
            if matches:
                sense = matches[0]
                print(f"[DEBUG] Fallback sense used: {sense}")
            else:
                print(f"[ERROR] No fallback match found.")
                raise ValueError("Word not in Sense2Vec vocabulary.")

        most_similar = s2v.most_similar(sense, n=20)
        print(f"[DEBUG] Retrieved {len(most_similar)} similar words.")

        distractors = []
        for each_word in most_similar:
            append_word = each_word[0].split("|")[0].replace("_", " ")
            if append_word.lower() != correct_answer.lower() and append_word not in distractors:
                distractors.append(append_word)

        print(f"[DEBUG] Found {len(distractors)} distractors: {distractors}")

        if not distractors:
            print("[WARNING] No valid distractors found. Falling back to default options.")
            return {
                "question": question,
                "options": [correct_answer] + [f"Option {i+1}" for i in range(3)],
                "answer": correct_answer
            }

        all_options = [correct_answer] + distractors
        print(f"[DEBUG] All options before encoding: {all_options}")
        answer_embedding = model.encode([correct_answer], convert_to_numpy=True).reshape(1, -1)
        distractor_embeddings = model.encode(all_options, convert_to_numpy=True)
        print(f"[DEBUG] Embedding shapes - answer: {answer_embedding.shape}, distractors: {distractor_embeddings.shape}")

        final_options = mmr(answer_embedding, distractor_embeddings, all_options, top_n=4)
        options = [opt.title() for opt in final_options]
        print(f"[DEBUG] Final MMR-selected options: {options}")
        random.shuffle(options)
        print(f"[DEBUG] Options after shuffling: {options}")

        return {
            "question": question,
            "options": options,
            "answer": correct_answer
        }

    except Exception as e:
        print(f"[ERROR] Exception in creating question: {e}")
        options = [correct_answer] + [f"Option {i+1}" for i in range(3)]
        random.shuffle(options)

        return {
            "question": question,
            "options": options,
            "answer": correct_answer
        }
