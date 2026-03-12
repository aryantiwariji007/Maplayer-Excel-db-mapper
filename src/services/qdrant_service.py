import os
import uuid
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
from .embedding import generate_embedding

COLLECTION_NAME = "maplayer_schemas"
VECTOR_SIZE = 384
QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")

try:
    qdrant = QdrantClient(url=QDRANT_URL, timeout=10)
except:
    qdrant = None

def init_qdrant():
    if not qdrant: return
    try:
        collections = qdrant.get_collections().collections
        exists = any(c.name == COLLECTION_NAME for c in collections)
        if not exists:
            print(f"Creating Qdrant collection: {COLLECTION_NAME}")
            qdrant.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE)
            )
            # Create payload index for fast filtering by schema_id
            qdrant.create_payload_index(
                collection_name=COLLECTION_NAME,
                field_name="schema_id",
                field_schema="keyword"
            )
    except Exception as e:
        print(f"Failed to initialize Qdrant: {e}")

def sync_schema_embeddings(schema_id: str, columns: list):
    if not qdrant: return
    print(f"Syncing embeddings for schema: {schema_id}")
    try:
        # First, delete existing points for this schema
        qdrant.delete(
            collection_name=COLLECTION_NAME,
            points_selector=Filter(
                must=[FieldCondition(key="schema_id", match=MatchValue(value=schema_id))]
            )
        )

        points = []
        for col in columns:
            text_to_embed = col.label if col.label else col.key
            text_to_embed = str(text_to_embed).lower().replace("_", " ").replace("-", " ") 
            try:
                vector = generate_embedding(text_to_embed)
                points.append(PointStruct(
                    id=str(uuid.uuid4()),
                    vector=vector,
                    payload={
                        "schema_id": schema_id,
                        "target_key": col.key,
                        "label": col.label
                    }
                ))
            except Exception as e:
                print(f"Failed to generate embedding for {col.key}: {e}")

        if points:
            qdrant.upsert(
                collection_name=COLLECTION_NAME,
                points=points
            )
            print(f"Synced {len(points)} fields to Qdrant for schema {schema_id}.")
    except Exception as e:
        print(f"Qdrant sync failed for schema {schema_id}: {e}")

def search_semantic_similarity(column_embedding: list[float], schema_id: str, limit: int = 1):
    if not qdrant: return []
    try:
        # Using query_points (Modern Discovery API) since 'search' is missing in this client version
        response = qdrant.query_points(
            collection_name=COLLECTION_NAME,
            query=column_embedding,
            limit=limit,
            query_filter=Filter(
                must=[FieldCondition(key="schema_id", match=MatchValue(value=schema_id))]
            )
        )
        # In query_points, results are in .points
        return [{"target_key": r.payload.get("target_key"), "score": r.score} for r in response.points]
    except Exception as e:
        print(f"Qdrant search failed: {e}")
        return []
