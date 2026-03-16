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


def get_logical_schema_columns(db: Session, logical_dataset_id: str) -> list[str]:
    """Retrieves all unique target column names currently in the logical dataset."""
    from ..models import LogicalDatasetMapping
    mappings = db.execute(
        select(LogicalDatasetMapping).where(LogicalDatasetMapping.logical_dataset_id == logical_dataset_id)
    ).scalars().all()
    
    unique_target_cols = set()
    for m in mappings:
        for target_col in m.column_mapping.values():
            unique_target_cols.add(target_col)
    
    return list(unique_target_cols)


def suggest_logical_dataset(
    db: Session,
    new_dataset_columns: list[dict],
    product_id: str,
    threshold: float = 0.50,
    sample_data: list[dict] = None
) -> list[dict]:
    """
    Find existing LogicalDatasets for a product whose member datasets (or name/desc)
    are similar to the new dataset. Returns ranked suggestions.
    """
    from ..models import LogicalDataset, LogicalDatasetMapping, Dataset, DatasetColumn

    # Load all logical datasets for product
    logical_datasets = db.execute(
        select(LogicalDataset).where(LogicalDataset.product_id == product_id)
    ).scalars().all()

    suggestions = []
    new_meta = {"columns": new_dataset_columns}
    new_names_bag = " ".join([c["normalized_name"] for c in new_dataset_columns])

    for ld in logical_datasets:
        score = 0.0
        # 1. Compare against LD Name and Description (Semantic/Context Match)
        try:
            name_context_score = _embedding_similarity(new_names_bag, f"{ld.dataset_name} {ld.description}")
            # Boost if name matches exactly
            if ld.dataset_name.lower() in new_names_bag.lower() or any(ld.dataset_name.lower() in n.lower() for n in [c["normalized_name"] for c in new_dataset_columns]):
                name_context_score = max(name_context_score, 0.8)
        except Exception:
            name_context_score = 0.0

        # 2. Compare against existing member datasets
        member_score = 0.0
        mapping = db.execute(
            select(LogicalDatasetMapping)
            .where(LogicalDatasetMapping.logical_dataset_id == ld.id)
            .limit(1)
        ).scalars().first()

        if mapping:
            ref_cols = db.execute(
                select(DatasetColumn).where(DatasetColumn.dataset_id == mapping.dataset_id)
            ).scalars().all()
            ref_meta = {"columns": [{"normalized_name": c.normalized_name, "data_type": c.data_type} for c in ref_cols]}
            member_score = score_dataset_similarity(new_meta, ref_meta)
        
        # Combined score: prioritize member similarity if it exists, otherwise use name context
        score = max(member_score, name_context_score)

        if score >= threshold:
            # Generate the specific column alignment
            # If LD already has columns, use them. Otherwise use the new file's own columns as the target keys.
            ld_target_keys = get_logical_schema_columns(db, ld.id)
            source_cols = [c["normalized_name"] for c in new_dataset_columns]
            
            if ld_target_keys:
                suggested_map = generate_suggested_mapping(
                    source_cols, 
                    ld_target_keys, 
                    sample_data=sample_data, 
                    schema_description=ld.description
                )
            else:
                # FIRST FILE: Mapping is identity mapping (source -> source)
                # This "Initializes" the logical schema
                suggested_map = {c: c for c in source_cols}

            suggestions.append({
                "logical_dataset_id": ld.id,
                "logical_dataset_name": ld.dataset_name,
                "similarity_score": round(score, 3),
                "suggested_mapping": suggested_map
            })

    suggestions.sort(key=lambda x: x["similarity_score"], reverse=True)
    return suggestions


def generate_suggested_mapping(
    source_cols: list[str], 
    target_cols: list[str],
    sample_data: list[dict] = None,
    schema_description: str = None
) -> dict:
    """
    Suggest a mapping between source columns and target columns using Gemini AI preferably,
    and falling back to fuzzy matching if AI is unavailable or fails.
    """
    mapping = {}
    
    # Try AI Mapping first if sample data is provided
    if sample_data is not None:
        try:
            from .gemini import map_columns_with_ai
            ai_mappings = map_columns_with_ai(source_cols, sample_data, target_cols, schema_description)
            if ai_mappings:
                for m in ai_mappings:
                    # Only accept confident mappings
                    if m.get("target") and m.get("confidence", 0) > 0.60:
                        mapping[m["source"]] = m["target"]
                
                # If AI returned at least some mappings, we trust it and return
                if mapping:
                    print(f"DEBUG: Logical Dataset AI Mapping Success: {mapping}")
                    return mapping
        except Exception as e:
            print(f"DEBUG: AI Mapping fallback triggered due to error: {e}")

    # Fallback to Fuzzy Matching
    print("DEBUG: Using RapidFuzz fallback for Logical Dataset mapping")
    for s_col in source_cols:
        best_match = None
        best_score = 0
        for t_col in target_cols:
            score = fuzz.token_sort_ratio(s_col, t_col)
            if score > best_score:
                best_score = score
                best_match = t_col
        
        if best_match and best_score > 65:
            mapping[s_col] = best_match
            
    return mapping

