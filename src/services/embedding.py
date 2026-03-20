from sentence_transformers import SentenceTransformer

_model = None

def get_embedding_model():
    global _model
    if _model is None:
        print("Loading all-MiniLM-L6-v2 model...")
        _model = SentenceTransformer('all-MiniLM-L6-v2')
        print("Model loaded successfully.")
    return _model

def generate_embedding(text: str) -> list[float]:
    """Generates an embedding using the local all-MiniLM-L6-v2 model (MiniLM)."""
    model = get_embedding_model()
    if not text:
        text = ""
    # Normalize embeddings to match cosine similarity expectations
    vector = model.encode(text, normalize_embeddings=True)
    return vector.tolist()
