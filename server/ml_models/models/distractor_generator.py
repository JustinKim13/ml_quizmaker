import spacy
import random
from nltk.corpus import wordnet
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import CountVectorizer
from sentence_transformers import SentenceTransformer, util
import torch

# Use smaller models
nlp = spacy.load("en_core_web_sm")
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")

# Cache for embeddings
embedding_cache = {}

def get_embedding(text):
    """Cache embeddings for reuse."""
    if text not in embedding_cache:
        with torch.no_grad():  # Disable gradient calculation for inference
            embedding_cache[text] = embedding_model.encode(text, convert_to_tensor=True)
    return embedding_cache[text]

def batch_encode_texts(texts):
    """Encode multiple texts at once."""
    unique_texts = list(set(texts))  # Remove duplicates
    with torch.no_grad():
        embeddings = embedding_model.encode(unique_texts, convert_to_tensor=True, batch_size=32)
    return dict(zip(unique_texts, embeddings))

def extract_relevant_named_entities(context, correct_answer):
    """Extract named entities efficiently."""
    doc = nlp(context)
    answer_doc = nlp(correct_answer)
    correct_type = answer_doc.ents[0].label_ if answer_doc.ents else None
    
    entities = set()
    for ent in doc.ents:
        if ent.text.lower() != correct_answer.lower():
            if not correct_type or ent.label_ == correct_type:
                entities.add(ent.text)
    return list(entities)

def generate_numeric_distractors(correct_answer, num_distractors=3):
    """Generate numeric distractors (unchanged as it's already fast)."""
    try:
        correct_number = int(correct_answer)
        distractors = [str(correct_number + i) for i in range(-5, 6) if i != 0]
        return random.sample(distractors, min(num_distractors, len(distractors)))
    except ValueError:
        return []

def generate_wordnet_distractors(correct_answer, num_distractors=5):
    """Generate WordNet distractors efficiently."""
    distractors = set()
    for syn in wordnet.synsets(correct_answer)[:3]:  # Limit synsets
        distractors.update(lemma.name().replace("_", " ") for lemma in syn.lemmas())
    distractors.discard(correct_answer)
    return list(distractors)[:num_distractors]

def generate_contextual_distractors(correct_answer, context, num_distractors=5):
    """Generate contextual distractors more efficiently."""
    words = list(set(token.text for token in nlp(context) if token.is_alpha and len(token.text) > 2))
    if len(words) <= num_distractors:
        return words

    # Batch process embeddings
    embeddings = batch_encode_texts([correct_answer] + words)
    correct_embed = embeddings[correct_answer]
    
    # Calculate similarities in batch
    similarities = util.pytorch_cos_sim(correct_embed, torch.stack([embeddings[w] for w in words]))[0]
    
    # Get top similar words
    top_indices = similarities.argsort(descending=True)[:num_distractors+1]
    return [words[i] for i in top_indices if words[i] != correct_answer][:num_distractors]

def filter_similar_distractors(correct_answer, distractors, similarity_threshold=0.8):
    """Filter distractors efficiently using batch processing."""
    if not distractors:
        return []
        
    # Batch encode all texts
    all_embeddings = batch_encode_texts([correct_answer] + distractors)
    correct_embed = all_embeddings[correct_answer]
    
    filtered_distractors = []
    distractor_embeds = torch.stack([all_embeddings[d] for d in distractors])
    
    # Calculate similarities in one batch
    similarities = util.pytorch_cos_sim(correct_embed, distractor_embeds)[0]
    
    for idx, score in enumerate(similarities):
        if score < similarity_threshold:
            filtered_distractors.append(distractors[idx])
            
    return filtered_distractors

def create_multiple_choice(question, correct_answer, context, num_distractors=3):
    """Create multiple choice question with optimized distractor generation."""
    distractors = set()
    
    # Generate different types of distractors in parallel
    if len(correct_answer.split()) == 1:
        distractors.update(generate_wordnet_distractors(correct_answer, num_distractors))
    
    contextual_distractors = generate_contextual_distractors(correct_answer, context, num_distractors)
    distractors.update(contextual_distractors)
    
    # Filter distractors efficiently
    filtered_distractors = filter_similar_distractors(correct_answer, list(distractors))
    
    # Ensure minimum number of distractors
    while len(filtered_distractors) < num_distractors:
        filtered_distractors.append(f"Option {len(filtered_distractors) + 1}")
    
    # Create final question
    options = [correct_answer] + random.sample(filtered_distractors, num_distractors)
    random.shuffle(options)
    
    return {
        "question": question,
        "options": options,
        "answer": correct_answer
    }
