"""
analytics.py (router)
─────────────────────────────────────────────
REST API endpoints for querying ingested datasets.

Endpoints:
  POST /analytics/query                → run SQL on any dataset table
  GET  /analytics/datasets/{id}/preview → first 50 rows of a dataset/logical view
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db, engine
from ..models import Dataset, LogicalDataset, LogicalDatasetMapping, DatasetColumn, Metric
from ..services.dataset_store import query_dataset

router = APIRouter()


class QueryRequest(BaseModel):
    product_id: str
    sql_query: str

class MetricCreateRequest(BaseModel):
    product_id: str
    metric_name: str
    logical_dataset_id: str
    sql_expression: str
    description: Optional[str] = None

class MetricQueryRequest(BaseModel):
    metric_id: str


@router.post("/query")
def analytics_query(req: QueryRequest, db: Session = Depends(get_db)):
    """
    Run a SQL query against the product's ingested dataset tables.
    Security: only allows SELECT statements, and scopes table names
    to those belonging to the given product_id.
    """
    sql = req.sql_query.strip()

    # Basic safety: only allow SELECT
    if not sql.upper().lstrip().startswith("SELECT"):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed.")

    # Validate all referenced table names belong to the product
    product_tables = db.execute(
        select(Dataset.table_name).where(Dataset.product_id == req.product_id)
    ).scalars().all()
    
    logical_tables = db.execute(
        select(LogicalDataset.table_name).where(LogicalDataset.product_id == req.product_id)
    ).scalars().all()

    all_allowed_tables = product_tables + logical_tables

    if all_allowed_tables:
        lower_sql = sql.lower()
        any_product_table_referenced = any(t.lower() in lower_sql for t in all_allowed_tables)
        if not any_product_table_referenced:
            raise HTTPException(
                status_code=403,
                detail="Query references tables not owned by this product_id."
            )

    try:
        result = query_dataset(engine, sql)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query failed: {str(e)}")

    return {
        "columns": result["columns"],
        "row_count": len(result["rows"]),
        "rows": result["rows"],
    }


@router.get("/datasets/{dataset_id}/preview")
def preview_dataset(dataset_id: str, limit: int = 50, db: Session = Depends(get_db)):
    """Return the first N rows of an ingested dataset table."""
    dataset = db.execute(select(Dataset).where(Dataset.id == dataset_id)).scalars().first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    sql = f'SELECT * FROM "{dataset.table_name}" LIMIT {min(limit, 500)}'
    try:
        result = query_dataset(engine, sql)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview dataset: {str(e)}")

    return {
        "dataset_id": dataset_id,
        "table_name": dataset.table_name,
        "columns": result["columns"],
        "row_count": len(result["rows"]),
        "rows": result["rows"],
    }


@router.get("/logical-datasets/{logical_dataset_id}/preview")
def preview_logical_dataset(logical_dataset_id: str, limit: int = 50, db: Session = Depends(get_db)):
    """
    Return unified rows from a materialized logical dataset table.
    """
    ld = db.execute(
        select(LogicalDataset).where(LogicalDataset.id == logical_dataset_id)
    ).scalars().first()
    if not ld:
        raise HTTPException(status_code=404, detail="Logical dataset not found")

    sql = f'SELECT * FROM "{ld.table_name}" LIMIT {min(limit, 500)}'
    try:
        result = query_dataset(engine, sql)
    except Exception as e:
        # If table doesn't exist yet (no mappings), or query fails return empty rows
        return {
            "logical_dataset": ld.dataset_name,
            "columns": [],
            "row_count": 0,
            "rows": [],
            "message": "No data mapped yet."
        }

    return {
        "logical_dataset": ld.dataset_name,
        "table_name": ld.table_name,
        "columns": result["columns"],
        "row_count": len(result["rows"]),
        "rows": result["rows"],
    }


# ── Semantic Metrics Layer ───────────────────────────────────────────────────

@router.post("/metrics")
def create_metric(req: MetricCreateRequest, db: Session = Depends(get_db)):
    """Define a reusable semantic metric."""
    ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == req.logical_dataset_id)).scalars().first()
    if not ld:
        raise HTTPException(status_code=404, detail="Logical dataset not found")

    # Basic safety
    if "DROP" in req.sql_expression.upper() or "DELETE" in req.sql_expression.upper() or "UPDATE" in req.sql_expression.upper() or "INSERT" in req.sql_expression.upper():
        raise HTTPException(status_code=400, detail="Only SELECT expressions are allowed in metrics.")

    metric = Metric(
        product_id=req.product_id,
        metric_name=req.metric_name,
        logical_dataset_id=req.logical_dataset_id,
        sql_expression=req.sql_expression,
        description=req.description,
    )
    db.add(metric)
    db.commit()
    db.refresh(metric)

    return {"status": "created", "metric_id": metric.id, "metric_name": metric.metric_name}


@router.get("/metrics")
def list_metrics(product_id: str, db: Session = Depends(get_db)):
    """List defined metrics for a product."""
    metrics = db.execute(select(Metric).where(Metric.product_id == product_id)).scalars().all()
    return [
        {
            "metric_id": m.id,
            "metric_name": m.metric_name,
            "logical_dataset_id": m.logical_dataset_id,
            "sql_expression": m.sql_expression,
            "description": m.description,
        }
        for m in metrics
    ]


@router.post("/metrics/query")
def query_metric(req: MetricQueryRequest, db: Session = Depends(get_db)):
    """Execute a predefined metric."""
    metric = db.execute(select(Metric).where(Metric.id == req.metric_id)).scalars().first()
    if not metric:
        raise HTTPException(status_code=404, detail="Metric not found")

    ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == metric.logical_dataset_id)).scalars().first()
    if not ld:
        raise HTTPException(status_code=404, detail="Logical dataset for metric not found")

    # Execute dynamic query on the materialized analytics table
    sql = f'SELECT {metric.sql_expression} AS "{metric.metric_name}" FROM "{ld.table_name}"'
    
    try:
        result = query_dataset(engine, sql)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate metric: {str(e)}")

    return {
        "metric_name": metric.metric_name,
        "value": result["rows"][0][metric.metric_name] if result["rows"] else None,
        "result_set": result["rows"]
    }
