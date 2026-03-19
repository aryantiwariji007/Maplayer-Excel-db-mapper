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
from ..models import LogicalDataset
from ..utils.json_utils import sanitize_nans

router = APIRouter()

# ── In-DB storage (simple JSON approach — no extra migration needed) ──
# We store composite views in a lightweight table backed by JSONB.
# If you don't want a new migration, we can use an in-memory dict for prototyping.

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

# ── Simple in-memory store (replace with DB table if needed) ──────────────────
_composite_store: dict[str, dict] = {}


@router.post("/views")
def create_composite_view(req: CompositeViewCreateRequest, db: Session = Depends(get_db)):
    """Save a composite view definition."""
    if len(req.sources) < 2:
        raise HTTPException(status_code=400, detail="A composite view must have at least 2 sources.")

    view_id = str(uuid.uuid4())
    sources_out = []
    for src in req.sources:
        ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == src.dataset_id)).scalars().first()
        if not ld:
            raise HTTPException(status_code=404, detail=f"Dataset '{src.dataset_id}' not found.")
        sources_out.append({
            "dataset_type": src.dataset_type,
            "dataset_id": src.dataset_id,
            "dataset_name": ld.dataset_name,
            "table_name": ld.table_name,
            "join_key": src.join_key,
            "alias": src.alias,
        })

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
    """Execute a composite JOIN query across multiple analytics tables."""
    view = _composite_store.get(view_id)
    if not view:
        raise HTTPException(status_code=404, detail="Composite view not found.")

    sources = view["sources"]
    if len(sources) < 2:
        raise HTTPException(status_code=400, detail="View must have at least 2 sources.")

    # Build a multi-way JOIN. First source is the primary (FROM), rest are LEFT JOIN.
    primary = sources[0]
    p_alias = primary.get("alias") or "t1"
    from_clause = f'"{primary["table_name"]}" AS {p_alias}'

    join_clauses = []
    select_clauses = [f"{p_alias}.*"]
    for i, src in enumerate(sources[1:]):
        s_alias = src.get("alias") or f"t{i+2}"
        select_clauses.append(f"{s_alias}.*")
        join_clauses.append(
            f'LEFT JOIN "{src["table_name"]}" AS {s_alias} '
            f'ON {p_alias}."{primary["join_key"]}" = {s_alias}."{src["join_key"]}"'
        )

    sql = f"""
        SELECT {", ".join(select_clauses)}
        FROM {from_clause}
        {" ".join(join_clauses)}
        LIMIT {limit}
    """

    try:
        with engine.connect() as conn:
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = [dict(zip(columns, row)) for row in result.fetchall()]
        return sanitize_nans({"columns": columns, "rows": rows, "sql": sql.strip()})
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query failed: {str(e)}")


@router.delete("/views/{view_id}")
def delete_composite_view(view_id: str):
    """Delete a saved composite view."""
    if view_id not in _composite_store:
        raise HTTPException(status_code=404, detail="Composite view not found.")
    del _composite_store[view_id]
    return {"message": "Composite view deleted."}
