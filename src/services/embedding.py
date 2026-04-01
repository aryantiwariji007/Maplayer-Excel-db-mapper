from sentence_transformers import SentenceTransformer
from functools import lru_cache

_model = None

def get_embedding_model():
    global _model
    if _model is None:
        print("Loading all-MiniLM-L6-v2 model...")
        _model = SentenceTransformer('all-MiniLM-L6-v2')
        print("Model loaded successfully.")
    return _model

@lru_cache(maxsize=4096)
def generate_embedding(text: str) -> tuple:
    """Generates an embedding using the local all-MiniLM-L6-v2 model (MiniLM).
    Results are cached by text to avoid redundant computation across files in the same worker.
    Returns a tuple (hashable, required by lru_cache) — callers that need a list can call list() on it.
    """
    model = get_embedding_model()
    if not text:
        text = ""
    vector = model.encode(text, normalize_embeddings=True)
    return tuple(vector.tolist())
