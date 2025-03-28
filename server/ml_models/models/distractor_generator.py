import os
from sense2vec import Sense2Vec
from sentence_transformers import SentenceTransformer
from typing import List, Dict
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
import random
import re

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

def clean_word(word: str) -> str:
    """Clean word by removing URLs and other artifacts."""
    # Remove URL portions
    word = re.sub(r'\]\(http[^\)]+\)', '', word)
    # Remove any remaining brackets
    word = re.sub(r'[\[\]]', '', word)
    # Remove any trailing punctuation
    word = re.sub(r'[^\w\s-]$', '', word)
    return word.strip()

def clean_answer_for_lookup(answer: str) -> str:
    """Clean the answer for vocabulary lookup while preserving the original format."""
    words = answer.strip().lower().split()
    if words[0] in {"a", "an", "the"}:
        words = words[1:]
    return "_".join(words)

def create_multiple_choice(question: str, correct_answer: str, context: str) -> Dict:
    print(f"\n[DEBUG] Generating MCQ for question: {question}")
    
    # Add question mark if missing
    if not question.strip().endswith('?'):
        question = question.strip() + '?'
    
    # Clean answer first - remove Trivia and other artifacts
    correct_answer = correct_answer.split('Trivia')[0].strip()
    correct_answer = re.sub(r'\s*Question.*$', '', correct_answer).strip()
    # Convert correct answer to Title Case
    correct_answer = correct_answer.title()
    print(f"[DEBUG] Cleaned correct answer: {correct_answer}")

    try:
        lookup_variations = [
            clean_answer_for_lookup(correct_answer),
            correct_answer.lower().replace(" ", "_"),
            correct_answer.lower(),
        ]
        
        sense = None
        for lookup_word in lookup_variations:
            print(f"[DEBUG] Trying lookup word: {lookup_word}")
            if lookup_word in s2v:
                sense = s2v.get_best_sense(lookup_word)
                print(f"[DEBUG] Found direct match: {sense}")
                break
            else:
                # Find all similar words in vocabulary
                similar_words = [word for word in s2v.keys() if lookup_word in word.lower()]
                if similar_words:
                    # Sort by simplicity and relevance
                    similar_words.sort(key=lambda x: (
                        len(x.split('_')),
                        0 if x.split('|')[1] in ['NOUN', 'PERSON', 'GPE'] else 1,
                        1 if any(term in x.lower() for term in ['movie', 'show', 'express', 'film']) else 0,
                        0 if x.split('|')[0].lower() == lookup_word else 1
                    ))
                    
                    sense = similar_words[0]
                    print(f"[DEBUG] Found best similar word in vocab: {sense}")
                    break
        
        if sense:
            most_similar = s2v.most_similar(sense, n=30)
            distractors = []
            
            # Get the semantic type of the correct answer (e.g., color, state, person)
            answer_type = sense.split('|')[1]
            
            for each_word in most_similar:
                word = clean_word(each_word[0].split("|")[0].replace("_", " "))
                word_type = each_word[0].split("|")[1]
                similarity_score = each_word[1]
                
                # Convert distractor to Title Case
                word = word.title()
                
                print(f"[DEBUG] Considering distractor: {word} (score: {similarity_score}, type: {word_type})")
                
                # Skip if:
                if (word.lower() == correct_answer.lower() or  # Same as correct answer
                    word.lower() in correct_answer.lower() or  # Subset of correct answer
                    correct_answer.lower() in word.lower() or  # Superset of correct answer
                    any(word.lower() == d.lower() for d in distractors) or  # Duplicate
                    any(word.lower() in d.lower() or d.lower() in word.lower() for d in distractors) or  # Similar to existing
                    word_type != answer_type or  # Different semantic type
                    # Check for abbreviations/variants
                    any(are_variants(word, d) for d in [correct_answer] + distractors)):
                    continue
                
                distractors.append(word)
            
            if len(distractors) >= 3:
                options = [correct_answer] + distractors[:3]
                random.shuffle(options)
                return {
                    "question": question,
                    "options": options,
                    "answer": correct_answer
                }

        raise ValueError("No valid distractors found")

    except Exception as e:
        print(f"[ERROR] Exception in creating question: {str(e)}")
        options = [correct_answer] + [f"Option {i+1}" for i in range(3)]
        random.shuffle(options)
        return {
            "question": question,
            "options": options,
            "answer": correct_answer
        }

def are_variants(word1: str, word2: str) -> bool:
    """Check if two words are variants of each other (abbreviations, state names, etc.)"""
    w1, w2 = word1.lower(), word2.lower()
    
    # State abbreviations
    state_abbrev = {
        'new jersey': 'nj',
        'new york': 'ny',
        # Add more state abbreviations as needed
    }
    
    # Check if either word is an abbreviation of the other
    if w1 in state_abbrev and state_abbrev[w1] == w2:
        return True
    if w2 in state_abbrev and state_abbrev[w2] == w1:
        return True
    
    return False