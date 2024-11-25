import spacy
import random
from nltk.corpus import wordnet
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import CountVectorizer
from sentence_transformers import SentenceTransformer, util

# Load spaCy's large English model for better contextual embeddings
nlp = spacy.load("en_core_web_lg")

# Load a sentence embedding model
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")

def extract_relevant_named_entities(context, correct_answer):
    """
    Extract named entities of the same type as the correct answer.
    """
    doc = nlp(context)
    correct_type = nlp(correct_answer).ents[0].label_ if nlp(correct_answer).ents else None
    entities = [ent.text for ent in doc.ents if ent.text.lower() != correct_answer.lower()]
    
    # Filter named entities by type
    if correct_type:
        entities = [ent.text for ent in entities if ent.label_ == correct_type]
    return list(set(entities))  # Return unique entities

def generate_numeric_distractors(correct_answer, num_distractors=3):
    """
    Generate numeric distractors for numeric answers.
    """
    try:
        correct_number = int(correct_answer)
        distractors = [str(correct_number + i) for i in range(-5, 6) if i != 0]
        return random.sample(distractors, min(num_distractors, len(distractors)))
    except ValueError:
        return []  # If the correct answer is not numeric

def generate_wordnet_distractors(correct_answer, num_distractors=5):
    """
    Generate synonyms and antonyms using WordNet.
    """
    distractors = set()
    for syn in wordnet.synsets(correct_answer):
        for lemma in syn.lemmas():
            distractors.add(lemma.name().replace("_", " "))
    distractors.discard(correct_answer)
    return random.sample(distractors, min(num_distractors, len(distractors)))

def generate_contextual_distractors(correct_answer, context, num_distractors=5):
    """
    Generate distractors using cosine similarity between words in the context and the correct answer.
    """
    words = [token.text for token in nlp(context) if token.is_alpha]
    distractors = []

    # Use CountVectorizer to build simple embeddings for words
    vectorizer = CountVectorizer().fit_transform([correct_answer] + words)
    vectors = vectorizer.toarray()

    # Compute cosine similarity
    cosine_sim = cosine_similarity(vectors[0].reshape(1, -1), vectors[1:])
    sorted_indices = cosine_sim.argsort()[0][::-1]
    
    for idx in sorted_indices:
        word = words[idx]
        if word != correct_answer and word not in distractors:
            distractors.append(word)
        if len(distractors) >= num_distractors:
            break

    return distractors

def filter_similar_distractors(correct_answer, distractors, similarity_threshold=0.8):
    """
    Filter out distractors that are too similar to the correct answer.
    """
    correct_embed = embedding_model.encode(correct_answer, convert_to_tensor=True)
    filtered_distractors = []

    for distractor in distractors:
        distractor_embed = embedding_model.encode(distractor, convert_to_tensor=True)
        similarity_score = util.pytorch_cos_sim(correct_embed, distractor_embed).item()

        # Only add distractors that are sufficiently different
        if similarity_score < similarity_threshold:
            filtered_distractors.append(distractor)

    return filtered_distractors

def ensure_min_distractors(distractors, correct_answer, num_distractors):
    """
    Ensure there are enough distractors by adding generic placeholders if needed.
    """
    while len(distractors) < num_distractors:
        distractors.append(f"Option {len(distractors) + 1}")
    return distractors

def create_multiple_choice(question, correct_answer, context, num_distractors=3):
    """
    Create a multiple-choice question with better distractors.
    """
    distractors = set()

    # Generate candidates from WordNet and context
    if len(correct_answer.split()) == 1:  # Single-word answer
        wordnet_distractors = generate_wordnet_distractors(correct_answer, num_distractors * 2)
        distractors.update(wordnet_distractors)

    contextual_distractors = generate_contextual_distractors(correct_answer, context, num_distractors * 2)
    distractors.update(contextual_distractors)

    # Filter and rank distractors by similarity
    filtered_distractors = filter_similar_distractors(correct_answer, list(distractors))

    # Ensure minimum number of distractors
    distractors = ensure_min_distractors(filtered_distractors, correct_answer, num_distractors)

    # Shuffle correct answer with distractors
    options = [correct_answer] + random.sample(distractors, num_distractors)
    random.shuffle(options)

    return {
        "question": question,
        "options": options,
        "answer": correct_answer,
    }
