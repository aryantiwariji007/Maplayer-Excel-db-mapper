"""
similarity.py
─────────────────────────────────────────────
Scores similarity between two datasets to determine if they represent
the same logical concept, using name fuzzy matching + type overlap + embeddings.
"""

from rapidfuzz import fuzz
from sqlalchemy.orm import Session
from sqlalchemy import select

from .embedding import generate_embedding
from .qdrant_service import search_semantic_similarity


def _embedding_similarity(text_a: str, text_b: str) -> float:
    """Cosine similarity approximation using dot product of unit vectors."""
    import numpy as np
    va = generate_embedding(text_a)
    vb = generate_embedding(text_b)
    return float(np.dot(va, vb))


def _name_similarity(cols_a: list[str], cols_b: list[str]) -> float:
    """Average best fuzzy match ratio across columns."""
    if not cols_a or not cols_b:
        return 0.0
    scores = []
    for a in cols_a:
        best = max(fuzz.token_sort_ratio(a, b) for b in cols_b) / 100.0
        scores.append(best)
    return sum(scores) / len(scores)


def _type_overlap(cols_a: list[dict], cols_b: list[dict]) -> float:
    """Fraction of matched column pairs with the same data type."""
    if not cols_a or not cols_b:
        return 0.0
    type_map_b = {c["normalized_name"]: c["data_type"] for c in cols_b}
    type_map_a = {c["normalized_name"]: c["data_type"] for c in cols_a}
    matched = 0
    total = 0
    for k, t in type_map_a.items():
        if k in type_map_b:
            total += 1
            if type_map_b[k] == t:
                matched += 1
    return matched / total if total else 0.0


def score_dataset_similarity(dataset_a: dict, dataset_b: dict) -> float:
    """
    Composite similarity score between two dataset metadata dicts.
    Each dict has: { "columns": [{"normalized_name", "data_type"}, ...] }
    Score weights:
        name_similarity   40%
        type_overlap      30%
        semantic (file)   30%
    """
    names_a = [c["normalized_name"] for c in dataset_a["columns"]]
    names_b = [c["normalized_name"] for c in dataset_b["columns"]]

    name_score = _name_similarity(names_a, names_b)
    type_score = _type_overlap(dataset_a["columns"], dataset_b["columns"])

    # Semantic: compare concatenated column names as a bag-of-words sentence
    try:
        sem_score = _embedding_similarity(" ".join(names_a), " ".join(names_b))
    except Exception:
        sem_score = 0.0

    return 0.40 * name_score + 0.30 * type_score + 0.30 * sem_score


def suggest_logical_dataset(
    db: Session,
    new_dataset_columns: list[dict],
    product_id: str,
    threshold: float = 0.60,
) -> list[dict]:
    """
    Find existing LogicalDatasets for a product whose member datasets are similar
    to the new dataset. Returns ranked suggestions above the threshold.
    """
    from ..models import LogicalDataset, LogicalDatasetMapping, Dataset, DatasetColumn

    # Load all logical datasets for product
    logical_datasets = db.execute(
        select(LogicalDataset).where(LogicalDataset.product_id == product_id)
    ).scalars().all()

    suggestions = []
    new_meta = {"columns": new_dataset_columns}

    for ld in logical_datasets:
        # Get one representative member dataset's columns
        mapping = db.execute(
            select(LogicalDatasetMapping)
            .where(LogicalDatasetMapping.logical_dataset_id == ld.id)
            .limit(1)
        ).scalars().first()
        if not mapping:
            continue

        ref_cols = db.execute(
            select(DatasetColumn).where(DatasetColumn.dataset_id == mapping.dataset_id)
        ).scalars().all()
        ref_meta = {"columns": [{"normalized_name": c.normalized_name, "data_type": c.data_type} for c in ref_cols]}

        score = score_dataset_similarity(new_meta, ref_meta)
        if score >= threshold:
            # Generate the specific column alignment
            target_cols = [c.normalized_name for c in ref_cols]
            source_cols = [c["normalized_name"] for c in new_dataset_columns]
            suggested_map = generate_suggested_mapping(source_cols, target_cols)

            suggestions.append({
                "logical_dataset_id": ld.id,
                "logical_dataset_name": ld.dataset_name,
                "similarity_score": round(score, 3),
                "suggested_mapping": suggested_map
            })

    suggestions.sort(key=lambda x: x["similarity_score"], reverse=True)
    return suggestions


def generate_suggested_mapping(source_cols: list[str], target_cols: list[str]) -> dict:
    """
    Automatically Suggest a mapping between source columns and target columns.
    Returns: { "source_col": "target_col" }
    """
    mapping = {}
    for s_col in source_cols:
        # Find best fuzzy match in target
        best_match = None
        best_score = 0
        for t_col in target_cols:
            score = fuzz.token_sort_ratio(s_col, t_col)
            if score > best_score:
                best_score = score
                best_match = t_col
        
        # Only map if match is decent (e.g. > 70%)
        if best_match and best_score > 70:
            mapping[s_col] = best_match
            
    return mapping
