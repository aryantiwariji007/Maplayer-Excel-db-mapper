"""
schema_resolver.py
─────────────────────────────────────────────
Unified Schema Resolution Service.

Given a new uploaded dataset (columns + sample data), this service
searches BOTH static TargetSchemas and dynamic LogicalDatasets to find
the best matching schema, then performs column alignment using a
3-tier semantic engine:

  Tier 1: Gemini AI (primary — uses full sample data context)
  Tier 2: Qdrant vector similarity (semantic column embeddings)
  Tier 3: RapidFuzz fuzzy name matching (deterministic fallback)

Returns a SchemaMatch dataclass describing:
  - schema_type: "static" | "dynamic" | "none"
  - schema_id / logical_dataset_id
  - schema_name
  - confidence score (0–1)
  - column_mapping: {source_col -> target_col}
  - reason: human-readable explanation
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..models import TargetSchema, TargetColumn, LogicalDataset, LogicalDatasetMapping, DatasetColumn


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class SchemaMatch:
    schema_type: str          # "static" | "dynamic" | "none"
    schema_id: Optional[str] = None          # TargetSchema.id
    logical_dataset_id: Optional[str] = None # LogicalDataset.id
    schema_name: str = "Unknown"
    confidence: float = 0.0
    column_mapping: dict = field(default_factory=dict)  # {source -> target}
    reason: str = ""
    # For analytics: which table to write rows into 
    analytics_table: Optional[str] = None


# ── Main Entry Point ──────────────────────────────────────────────────────────

def resolve_best_schema(
    db: Session,
    source_columns: list[dict],   # [{normalized_name, data_type}, ...]
    sample_data: list[dict],      # first N rows from the file
    product_id: str,
    static_threshold: float = 0.65,
    dynamic_threshold: float = 0.50,
) -> SchemaMatch:
    """
    Find the best matching schema (static or dynamic) for the given
    source columns + sample data.

    Resolution order:
      1. Try Gemini AI with all candidates in a single call
      2. Score static schemas via Qdrant + fuzzy
      3. Score dynamic logical datasets via name/member similarity
      4. Return best overall match above threshold
    """
    source_col_names = [c["normalized_name"] for c in source_columns]

    # ── 1. Load candidates ──────────────────────────────────────────────────
    static_schemas = db.execute(
        select(TargetSchema).where(TargetSchema.product_id == product_id)
    ).scalars().unique().all()

    logical_datasets = db.execute(
        select(LogicalDataset).where(LogicalDataset.product_id == product_id)
    ).scalars().all()

    if not static_schemas and not logical_datasets:
        return SchemaMatch(schema_type="none", reason="No schemas available for this product.")

    # ── 2. Build candidate descriptors for Gemini ──────────────────────────
    static_candidates = []
    for s in static_schemas:
        static_candidates.append({
            "id": s.id,
            "name": s.schema_name,
            "description": s.description or "",
            "target_keys": [c.key for c in s.columns],
            "target_labels": {c.key: c.label for c in s.columns},
            "target_descriptions": {c.key: (c.description or "") for c in s.columns},
            "aliases": {c.key: (c.aliases or []) for c in s.columns},
        })

    dynamic_candidates = []
    for ld in logical_datasets:
        ld_cols = _get_ld_columns(db, ld.id)
        dynamic_candidates.append({
            "id": ld.id,
            "name": ld.dataset_name,
            "description": ld.description or "",
            "target_keys": ld_cols,
        })

    # ── 3. Gemini AI — primary resolver ────────────────────────────────────
    ai_match = _try_gemini_resolution(
        source_col_names, sample_data,
        static_candidates, dynamic_candidates
    )

    if ai_match and ai_match.confidence >= static_threshold:
        # Search Static Schemas
        match_id = ai_match.schema_id or ai_match.logical_dataset_id
        schema = next((s for s in static_schemas if str(s.id) == str(match_id)), None)
        if schema:
            mapping = _align_to_static(source_col_names, schema, sample_data, ai_match.column_mapping)
            ai_match.schema_type = "static"
            ai_match.schema_id = schema.id
            ai_match.column_mapping = mapping
            ai_match.analytics_table = _static_analytics_table(schema.id)
            return ai_match

    if ai_match and ai_match.confidence >= dynamic_threshold:
        # Search Dynamic Schemas
        match_id = ai_match.schema_id or ai_match.logical_dataset_id
        ld = next((d for d in logical_datasets if str(d.id) == str(match_id)), None)
        if ld:
            ld_cols = _get_ld_columns(db, ld.id)
            mapping = _align_to_dynamic(source_col_names, ld_cols, sample_data)
            ai_match.schema_type = "dynamic"
            ai_match.logical_dataset_id = ld.id
            ai_match.column_mapping = mapping
            ai_match.analytics_table = ld.table_name
            return ai_match

    # ── 4. Fallback: score all candidates numerically ───────────────────────
    best_static = _score_static_schemas(source_columns, static_schemas, sample_data, db)
    best_dynamic = _score_dynamic_schemas(source_columns, logical_datasets, sample_data, db)

    # Compare and pick winner
    best = None
    if best_static and best_static.confidence >= static_threshold:
        best = best_static
    if best_dynamic and best_dynamic.confidence >= dynamic_threshold:
        if best is None or best_dynamic.confidence > (best.confidence * 0.85):
            # Dynamic wins only if it's meaningfully better (or static wasn't good enough)
            if best is None or best_dynamic.confidence > best.confidence:
                best = best_dynamic

    if best:
        # Finalize mapping
        if best.schema_type == "static":
            schema = next((s for s in static_schemas if s.id == best.schema_id), None)
            if schema:
                best.column_mapping = _align_to_static(source_col_names, schema, sample_data, {})
                best.analytics_table = _static_analytics_table(schema.id)
        else:
            ld = next((d for d in logical_datasets if d.id == best.logical_dataset_id), None)
            if ld:
                ld_cols = _get_ld_columns(db, ld.id)
                best.column_mapping = _align_to_dynamic(source_col_names, ld_cols, sample_data)
                best.analytics_table = ld.table_name
        return best

    # ── 5. Tier 4 Fallback: suggest_logical_dataset (member-based similarity) ─
    # This was the original reliable mechanism — use it when all AI/numerical tiers miss.
    try:
        from .similarity import suggest_logical_dataset, get_logical_schema_columns, generate_suggested_mapping
        suggestions = suggest_logical_dataset(db, source_columns, product_id, threshold=0.50, sample_data=sample_data)
        if suggestions:
            best_sug = suggestions[0]  # Already sorted by similarity_score desc
            ld_id = best_sug["logical_dataset_id"]
            ld_name = best_sug["logical_dataset_name"]
            confidence = best_sug["similarity_score"]
            suggested_mapping = best_sug.get("suggested_mapping", {})

            # Find the LD table name
            ld_obj = next((d for d in logical_datasets if d.id == ld_id), None)
            if ld_obj:
                if not suggested_mapping:
                    ld_cols = _get_ld_columns(db, ld_id)
                    suggested_mapping = _align_to_dynamic(source_col_names, ld_cols, sample_data)

                print(f"DEBUG: Tier-4 fallback matched dynamic schema '{ld_name}' (score={confidence:.3f})")
                return SchemaMatch(
                    schema_type="dynamic",
                    logical_dataset_id=ld_id,
                    schema_name=ld_name,
                    confidence=confidence,
                    column_mapping=suggested_mapping,
                    analytics_table=ld_obj.table_name,
                    reason=f"Tier-4 member similarity: {confidence:.2f}"
                )
    except Exception as e:
        print(f"DEBUG: Tier-4 suggest_logical_dataset failed: {e}")

    return SchemaMatch(schema_type="none", reason="No schema matched with sufficient confidence.")



# ── Gemini AI Resolution ──────────────────────────────────────────────────────

def _try_gemini_resolution(
    source_cols: list[str],
    sample_data: list[dict],
    static_candidates: list[dict],
    dynamic_candidates: list[dict],
) -> Optional[SchemaMatch]:
    """Ask Gemini AI to pick the best schema from all candidates."""
    try:
        from .gemini import choose_best_schema_with_ai
        result = choose_best_schema_with_ai(
            source_cols, sample_data, static_candidates, dynamic_candidates
        )
        if not result:
            return None

        schema_type = result.get("schema_type", "none")
        confidence = float(result.get("confidence", 0.0))
        column_mapping = result.get("column_mapping", {})
        reason = result.get("reason", "")

        if schema_type == "static":
            return SchemaMatch(
                schema_type="static",
                schema_id=result.get("schema_id"),
                schema_name=result.get("schema_name", ""),
                confidence=confidence,
                column_mapping=column_mapping,
                reason=f"Gemini AI: {reason}",
            )
        elif schema_type == "dynamic":
            return SchemaMatch(
                schema_type="dynamic",
                logical_dataset_id=result.get("schema_id"),
                schema_name=result.get("schema_name", ""),
                confidence=confidence,
                column_mapping=column_mapping,
                reason=f"Gemini AI: {reason}",
            )
    except Exception as e:
        print(f"DEBUG: Gemini schema resolution failed, using fallback: {e}")
    return None


# ── Static Schema Scoring ─────────────────────────────────────────────────────

def _score_static_schemas(
    source_cols: list[dict],
    schemas: list,
    sample_data: list[dict],
    db: Session,
) -> Optional[SchemaMatch]:
    """Score all static schemas and return best match."""
    best_match: Optional[SchemaMatch] = None
    source_names = [c["normalized_name"] for c in source_cols]
    source_bag = " ".join(source_names)

    for schema in schemas:
        target_keys = [c.key for c in schema.columns]
        target_labels = [c.label for c in schema.columns]
        target_aliases_flat = []
        for c in schema.columns:
            target_aliases_flat.extend(c.aliases or [])

        # Qdrant vector similarity (semantic)
        qdrant_score = _qdrant_static_score(source_names, str(schema.id))

        # Fuzzy name matching against keys + labels + aliases
        fuzzy_score = _fuzzy_match_score(source_names, target_keys + target_labels + target_aliases_flat)

        # Description/name embedding similarity
        sem_score = _semantic_bag_similarity(source_bag, f"{schema.schema_name} {schema.description}")

        composite = 0.3 * qdrant_score + 0.4 * fuzzy_score + 0.3 * sem_score

        if best_match is None or composite > best_match.confidence:
            best_match = SchemaMatch(
                schema_type="static",
                schema_id=str(schema.id),
                schema_name=schema.schema_name,
                confidence=round(composite, 3),
                reason=f"Fallback: qdrant={qdrant_score:.2f}, fuzzy={fuzzy_score:.2f}, sem={sem_score:.2f}",
            )

    return best_match


# ── Dynamic Schema Scoring ────────────────────────────────────────────────────

def _score_dynamic_schemas(
    source_cols: list[dict],
    logical_datasets: list,
    sample_data: list[dict],
    db: Session,
) -> Optional[SchemaMatch]:
    """Score all dynamic logical datasets and return best match."""
    best_match: Optional[SchemaMatch] = None
    source_names = [c["normalized_name"] for c in source_cols]
    source_bag = " ".join(source_names)

    for ld in logical_datasets:
        ld_cols = _get_ld_columns(db, ld.id)

        # Name + description semantic similarity
        sem_score = _semantic_bag_similarity(source_bag, f"{ld.dataset_name} {ld.description}")

        # Fuzzy column name overlap with existing LD columns
        fuzzy_score = _fuzzy_match_score(source_names, ld_cols) if ld_cols else 0.2

        # Boost if LD name matches a source column name exactly
        name_boost = 0.0
        ld_name_lower = ld.dataset_name.lower().replace("_", " ").replace("-", " ")
        for col in source_names:
            col_lower = col.lower().replace("_", " ")
            if ld_name_lower in col_lower or col_lower in ld_name_lower:
                name_boost = 0.15
                break

        composite = min(0.45 * sem_score + 0.40 * fuzzy_score + 0.15 + name_boost, 1.0)

        if best_match is None or composite > best_match.confidence:
            best_match = SchemaMatch(
                schema_type="dynamic",
                logical_dataset_id=ld.id,
                schema_name=ld.dataset_name,
                confidence=round(composite, 3),
                reason=f"Fallback: sem={sem_score:.2f}, fuzzy={fuzzy_score:.2f}, boost={name_boost}",
            )

    return best_match


# ── Column Alignment Helpers ──────────────────────────────────────────────────

def _align_to_static(
    source_cols: list[str],
    schema,
    sample_data: list[dict],
    ai_map: dict,
) -> dict:
    """Use AI map if provided, else fall back to semantic+fuzzy for static schema."""
    if ai_map:
        # Validate AI map — only keep valid target keys
        valid_keys = {c.key for c in schema.columns}
        clean_map = {s: t for s, t in ai_map.items() if t in valid_keys and s in source_cols}
        if clean_map:
            return clean_map

    # Fallback to generate_suggested_mapping with rich column metadata
    try:
        from .similarity import generate_suggested_mapping
        target_cols_rich = [c for c in schema.columns]  # Pass full objects
        return generate_suggested_mapping(
            source_cols, target_cols_rich, sample_data=sample_data,
            schema_description=schema.description
        )
    except Exception as e:
        print(f"DEBUG: Static alignment fallback failed: {e}")
        return {}


def _align_to_dynamic(
    source_cols: list[str],
    ld_cols: list[str],
    sample_data: list[dict],
) -> dict:
    """Fuzzy/AI alignment for dynamic logical datasets."""
    if not ld_cols:
        # First file: identity mapping, column names become the schema
        return {c: c for c in source_cols}

    try:
        from .similarity import generate_suggested_mapping
        return generate_suggested_mapping(source_cols, ld_cols, sample_data=sample_data)
    except Exception as e:
        print(f"DEBUG: Dynamic alignment fallback failed: {e}")
        return {c: c for c in source_cols}


# ── Utility Functions ─────────────────────────────────────────────────────────

def _get_ld_columns(db: Session, ld_id: str) -> list[str]:
    """Get all unique target column names for a logical dataset."""
    mappings = db.execute(
        select(LogicalDatasetMapping).where(LogicalDatasetMapping.logical_dataset_id == ld_id)
    ).scalars().all()
    unique = set()
    for m in mappings:
        unique.update(m.column_mapping.values())
    return list(unique)


def _static_analytics_table(schema_id: str) -> str:
    return f"mapped_{str(schema_id).replace('-', '_')}"


def _qdrant_static_score(source_cols: list[str], schema_id: str) -> float:
    """Average best Qdrant vector similarity for source columns against a static schema."""
    try:
        from .embedding import generate_embedding
        from .qdrant_service import search_semantic_similarity
        scores = []
        for col in source_cols[:10]:  # Limit to first 10 to avoid slow queries
            text = col.replace("_", " ").replace("-", " ")
            vec = generate_embedding(text)
            results = search_semantic_similarity(vec, schema_id, limit=1)
            if results:
                scores.append(results[0]["score"])
        return sum(scores) / len(scores) if scores else 0.0
    except Exception:
        return 0.0


def _fuzzy_match_score(source_names: list[str], target_names: list[str]) -> float:
    """Average best fuzzy match ratio across source columns."""
    if not target_names:
        return 0.0
    try:
        from rapidfuzz import fuzz
        scores = []
        for src in source_names:
            best = max(fuzz.token_sort_ratio(src, tgt) for tgt in target_names) / 100.0
            scores.append(best)
        return sum(scores) / len(scores) if scores else 0.0
    except Exception:
        return 0.0


def _semantic_bag_similarity(text_a: str, text_b: str) -> float:
    """Embedding cosine similarity between two text bags."""
    try:
        import numpy as np
        from .embedding import generate_embedding
        va = generate_embedding(text_a)
        vb = generate_embedding(text_b)
        return float(np.dot(va, vb))
    except Exception:
        return 0.0
