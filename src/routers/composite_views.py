"""
composite_views.py
─────────────────────────────────────────────
Layer 3: Cross-Dataset Composite Analytics.

Allows users to define a saved JOIN across multiple LogicalDatasets
(or static schema analytics tables) and query them as a single unified view.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from typing import Optional, List
import uuid

from ..database import get_db, engine
from ..models import LogicalDataset, TargetSchema
from ..utils.json_utils import sanitize_nans
from ..services.dataset_store import query_dataset
from ..services.gemini import discover_metrics_with_ai

router = APIRouter()

# ── In-DB storage (simple JSON approach — no extra migration needed) ──
_composite_store: dict[str, dict] = {}

# ── Pydantic models ───────────────────────────────────────────────────────────

class CompositeViewSourceRequest(BaseModel):
    dataset_type: str       # "static" | "dynamic"
    dataset_id: str         # LogicalDataset.id (both static proxy and dynamic)
    join_key: str           # column to join on
    alias: str              # short alias used in SQL

class CompositeViewCreateRequest(BaseModel):
    product_id: str
    view_name: str
    description: Optional[str] = None
    sources: List[CompositeViewSourceRequest]

class CompositeAnalyzeRequest(BaseModel):
    sql_query: str

# ── Helper: Build base JOIN SQL ──────────────────────────────────────────────

def build_view_join_sql(sources: List[dict]):
    if len(sources) < 2:
        return None

    # First source is primary
    primary = sources[0]
    p_alias = (primary.get("alias") or "t1").strip()
    # Normalize join keys for Postgres
    p_key = primary["join_key"].strip().lower()
    from_clause = f'"{primary["table_name"]}" AS {p_alias}'

    join_clauses = []
    select_clauses = [f"{p_alias}.*"]
    for i, src in enumerate(sources[1:]):
        s_alias = (src.get("alias") or f"t{i+2}").strip()
        s_key = src["join_key"].strip().lower()
        select_clauses.append(f"{s_alias}.*")
        join_clauses.append(
            f'LEFT JOIN "{src["table_name"]}" AS {s_alias} '
            f'ON {p_alias}."{p_key}"::TEXT = {s_alias}."{s_key}"::TEXT'
        )

    base_sql = f"""
        SELECT {", ".join(select_clauses)}
        FROM {from_clause}
        {" ".join(join_clauses)}
    """
    return base_sql.strip()

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/views")
def create_composite_view(req: CompositeViewCreateRequest, db: Session = Depends(get_db)):
    """Save a composite view definition."""
    if len(req.sources) < 2:
        raise HTTPException(status_code=400, detail="A composite view must have at least 2 sources.")

    view_id = str(uuid.uuid4())
    sources_out = []
    for src in req.sources:
        # First try dynamic (LogicalDataset)
        ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == src.dataset_id)).scalars().first()
        if ld:
            sources_out.append({
                "dataset_type": "dynamic",
                "dataset_id": src.dataset_id,
                "dataset_name": ld.dataset_name,
                "table_name": ld.table_name,
                "join_key": src.join_key.strip().lower(),
                "alias": src.alias.strip(),
            })
        else:
            # Fallback: static TargetSchema
            ts = db.execute(select(TargetSchema).where(TargetSchema.id == src.dataset_id)).scalars().first()
            if ts:
                static_table = f"mapped_{str(ts.id).replace('-', '_')}"
                sources_out.append({
                    "dataset_type": "static",
                    "dataset_id": src.dataset_id,
                    "dataset_name": ts.schema_name,
                    "table_name": static_table,
                    "join_key": src.join_key.strip().lower(),
                    "alias": src.alias.strip(),
                })
            else:
                raise HTTPException(
                    status_code=404,
                    detail=f"Dataset '{src.dataset_id}' not found. Select a dataset from the dropdown."
                )

    view = {
        "id": view_id,
        "product_id": req.product_id,
        "view_name": req.view_name,
        "description": req.description,
        "sources": sources_out,
    }
    _composite_store[view_id] = view
    return view


@router.get("/views")
def list_composite_views(product_id: str):
    """List all saved composite views for a product."""
    return [v for v in _composite_store.values() if v["product_id"] == product_id]


@router.get("/views/{view_id}/query")
def query_composite_view(view_id: str, limit: int = 200):
    """Execute a simple preview of the composite view."""
    view = _composite_store.get(view_id)
    if not view:
        raise HTTPException(status_code=404, detail="Composite view not found.")

    sql = build_view_join_sql(view["sources"])
    if not sql:
        raise HTTPException(status_code=400, detail="View must have at least 2 sources.")

    sql_with_limit = f"{sql} LIMIT {limit}"

    try:
        result = query_dataset(engine, sql_with_limit)
        return sanitize_nans({
            "columns": result["columns"],
            "rows": result["rows"],
            "sql": sql_with_limit.strip()
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query failed: {str(e)}")


@router.post("/views/{view_id}/analyze")
def analyze_composite_view(view_id: str, req: CompositeAnalyzeRequest):
    """Run cross-dataset analytics using CTE on the composite view."""
    view = _composite_store.get(view_id)
    if not view:
        raise HTTPException(status_code=404, detail="Composite view not found.")

    base_sql = build_view_join_sql(view["sources"])
    if not base_sql:
        raise HTTPException(status_code=400, detail="Insufficient sources in view.")

    # Guard against destructive queries
    analysis_sql = req.sql_query.strip()
    if not analysis_sql.upper().startswith("SELECT"):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed.")

    # Wrap the join in a CTE called 'composite_view'
    full_sql = f"""
        WITH composite_view AS (
            {base_sql}
        )
        {analysis_sql}
    """

    try:
        result = query_dataset(engine, full_sql)
        return sanitize_nans({
            "columns": result["columns"],
            "rows": result["rows"],
            "sql": full_sql.strip(),
            "row_count": len(result["rows"])
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Analysis failed: {str(e)}")


@router.get("/views/{view_id}/discover-metrics")
def discover_composite_metrics(view_id: str):
    """Suggest business metrics leveraging the joined context of the view."""
    view = _composite_store.get(view_id)
    if not view:
        raise HTTPException(status_code=404, detail="Composite view not found.")

    base_sql = build_view_join_sql(view["sources"])
    if not base_sql:
        raise HTTPException(status_code=400, detail="Insufficient sources in view.")

    # 1. Get sample data (first 5 rows) to help AI understand the context
    sample_sql = f"{base_sql} LIMIT 5"
    try:
        result = query_dataset(engine, sample_sql)
        sample_data = result["rows"]
        columns = result["columns"]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch sample for discovery: {str(e)}")

    if not sample_data:
        raise HTTPException(status_code=400, detail="No data available in joined view to discover metrics.")

    # 2. Ask Gemini to suggest metrics for 'composite_view'
    suggestions = discover_metrics_with_ai(
        dataset_name=view["view_name"],
        columns=columns,
        sample_data=sample_data
    )

    return {
        "view_id": view_id,
        "view_name": view["view_name"],
        "suggested_metrics": suggestions
    }


@router.delete("/views/{view_id}")
def delete_composite_view(view_id: str):
    """Delete a saved composite view."""
    if view_id not in _composite_store:
        raise HTTPException(status_code=404, detail="Composite view not found.")
    del _composite_store[view_id]
    return {"message": "Composite view deleted."}
