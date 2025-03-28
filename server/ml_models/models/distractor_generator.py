import os
from sense2vec import Sense2Vec
from sentence_transformers import SentenceTransformer
from typing import List, Dict
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
import random
import re
import difflib

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

def proper_title_case(text: str) -> str:
    """
    Custom title case function that handles special cases like apostrophes and abbreviations.
    """
    # Special cases that should remain uppercase
    special_cases = {'U.S.', 'U.K.', 'E.T.', 'A.I.', 'U.N.', 'NASA', 'FBI', 'CIA'}
    
    # Words that should remain lowercase unless at start
    lowercase_words = {'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'in', 'to', 'at', 'by', 'of'}
    
    # Split on spaces while preserving whitespace
    words = text.split(' ')
    result = []
    
    for i, word in enumerate(words):
        # Skip empty strings
        if not word:
            result.append(word)
            continue
            
        # Check for special cases
        if word.upper() in special_cases:
            result.append(word.upper())
            continue
            
        # Handle apostrophes
        if "'" in word:
            parts = word.split("'")
            titled_parts = [part.capitalize() for part in parts]
            result.append("'".join(titled_parts))
            continue
            
        # Regular title case rules
        if i == 0 or word.lower() not in lowercase_words:
            result.append(word.capitalize())
        else:
            result.append(word.lower())
    
    return ' '.join(result)

def normalize_text(text: str) -> str:
    """
    Normalize text for comparison by removing punctuation and standardizing spacing.
    """
    # Remove line breaks
    text = text.replace('\n', ' ')
    # Standardize spaces
    text = ' '.join(text.split())
    # Convert to lowercase
    text = text.lower()
    # Remove punctuation except apostrophes
    text = re.sub(r'[^\w\s\']', '', text)
    # Standardize abbreviations
    text = text.replace('u.s.', 'us')
    text = text.replace('u.k.', 'uk')
    return text

def are_similar_answers(text1: str, text2: str) -> bool:
    """
    Check if two answers are similar or variants of each other.
    """
    t1 = normalize_text(text1)
    t2 = normalize_text(text2)
    
    # Direct match after normalization
    if t1 == t2:
        return True
        
    # Check for abbreviation variants
    abbrev_dict = {
        'united states': 'us',
        'united kingdom': 'uk',
        'national aeronautics and space administration': 'nasa',
        'federal bureau of investigation': 'fbi',
    }
    
    # Check if one is abbreviation of other
    for full, abbrev in abbrev_dict.items():
        if (t1 == full and t2 == abbrev) or (t2 == full and t1 == abbrev):
            return True
    
    # Check for high similarity using difflib
    similarity = difflib.SequenceMatcher(None, t1, t2).ratio()
    return similarity > 0.8

def is_answer_type_match(question: str, answer: str) -> bool:
    """Check if the answer type matches the question type."""
    question_lower = question.lower()
    answer_lower = answer.lower()
    
    # Check for question-answer type consistency
    if "what country" in question_lower:
        return not any(word in answer_lower for word in ["movie", "food", "drink", "year"])
    elif "what continent" in question_lower or "which continent" in question_lower:
        continents = {"asia", "africa", "europe", "north america", "south america", "australia", "antarctica"}
        return answer_lower in continents
    elif "what is the main ingredient" in question_lower:
        return not any(word in answer_lower for word in ["movie", "country", "year", "person"])
    elif "what movie" in question_lower:
        return not any(word in answer_lower for word in ["country", "food", "ingredient"])
    
    return True

def create_multiple_choice(question: str, correct_answer: str, context: str) -> Dict:
    print(f"\n[DEBUG] Generating MCQ for question: {question}")
    
    # Add question mark if missing
    if not question.strip().endswith('?'):
        question = question.strip() + '?'
    
    # Clean answer and apply proper title case
    correct_answer = correct_answer.split('Trivia')[0].strip()
    correct_answer = re.sub(r'\s*Question.*$', '', correct_answer).strip()
    original_answer = correct_answer  # Store original for case-insensitive comparison
    correct_answer = proper_title_case(correct_answer)
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
                        0 if x.split('|')[1] in ['NOUN', 'PERSON', 'GPE', 'LOC'] else 1,
                        1 if any(term in x.lower() for term in ['movie', 'show', 'express', 'film']) else 0,
                        0 if x.split('|')[0].lower() == lookup_word else 1
                    ))
                    
                    sense = similar_words[0]
                    print(f"[DEBUG] Found best similar word in vocab: {sense}")
                    break
        
        if sense:
            most_similar = s2v.most_similar(sense, n=30)
            distractors = []
            
            # Get the semantic type of the correct answer
            answer_type = sense.split('|')[1]
            
            # Use MMR to get diverse but relevant distractors
            word_embeddings = []
            words = []
            
            for each_word in most_similar:
                word = clean_word(each_word[0].split("|")[0].replace("_", " "))
                word_type = each_word[0].split("|")[1]
                
                # Apply proper title case
                word = proper_title_case(word)
                
                # Basic filtering before embedding
                if (are_similar_answers(word, correct_answer) or  # Similar to correct answer
                    any(are_similar_answers(word, d) for d in distractors) or  # Similar to existing
                    word_type != answer_type or  # Different semantic type
                    not is_answer_type_match(question, word)):  # Doesn't match question type
                    continue
                
                # Get word embedding
                try:
                    word_embedding = model.encode([word])[0]
                    word_embeddings.append(word_embedding)
                    words.append(word)
                except Exception as e:
                    print(f"[DEBUG] Error encoding word {word}: {str(e)}")
                    continue
                
                if len(words) >= 10:  # Get enough candidates for MMR
                    break
            
            if words:
                # Convert to numpy arrays
                word_embeddings = np.array(word_embeddings)
                doc_embedding = model.encode([correct_answer])[0].reshape(1, -1)
                
                # Use MMR to select diverse distractors
                selected_distractors = mmr(doc_embedding, word_embeddings, words, top_n=3, diversity=0.9)
                distractors.extend(selected_distractors)
            
            if len(distractors) >= 3:
                options = [correct_answer] + distractors[:3]
                random.shuffle(options)
                return {
                    "question": question,
                    "options": options,
                    "answer": correct_answer,
                    "case_insensitive_answer": original_answer,
                    "correct_answer": original_answer
                }

        raise ValueError("No valid distractors found")

    except Exception as e:
        print(f"[ERROR] Exception in creating question: {str(e)}")
        return None

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

def check_answer(user_answer: str, correct_answer: str) -> bool:
    """Case-insensitive answer checking."""
    if not user_answer or not correct_answer:
        return False
    return user_answer.lower().strip() == correct_answer.lower().strip()