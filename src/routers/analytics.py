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
from ..models import Dataset, LogicalDataset, LogicalDatasetMapping, DatasetColumn, Metric, DatasetProfile, DataAnomaly, TrendAnalysis, DatasetInsight, DatasetFileProfile, DatasetFileAnomaly, DatasetFileInsight, TargetSchema
from ..services.dataset_store import query_dataset, get_table_columns
from ..services.gemini import discover_metrics_with_ai
from ..utils.json_utils import sanitize_nans

router = APIRouter()


class QueryRequest(BaseModel):
    product_id: str
    sql_query: str

class MetricCreateRequest(BaseModel):
    product_id: str
    metric_name: str
    target_id: str
    target_type: str = "logical"
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

    return sanitize_nans({
        "columns": result["columns"],
        "row_count": len(result["rows"]),
        "rows": result["rows"],
    })


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

    return sanitize_nans({
        "dataset_id": dataset_id,
        "table_name": dataset.table_name,
        "columns": result["columns"],
        "row_count": len(result["rows"]),
        "rows": result["rows"],
    })


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

    # We join with the datasets table to get the human-readable filename for each row
    sql = f'''
        SELECT d.file_name AS source_file, t.* 
        FROM "{ld.table_name}" t
        LEFT JOIN datasets d ON t.dataset_id = d.id
        LIMIT {min(limit, 500)}
    '''
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

    return sanitize_nans({
        "logical_dataset": ld.dataset_name,
        "table_name": ld.table_name,
        "columns": result["columns"],
        "row_count": len(result["rows"]),
        "rows": result["rows"],
    })


# ── Semantic Metrics Layer ───────────────────────────────────────────────────

@router.post("/metrics")
def create_metric(req: MetricCreateRequest, db: Session = Depends(get_db)):
    """Define a reusable semantic metric."""
    if req.target_type == "logical":
        target = db.execute(select(LogicalDataset).where(LogicalDataset.id == req.target_id)).scalars().first()
    else:
        target = db.execute(select(Dataset).where(Dataset.id == req.target_id)).scalars().first()

    if not target:
        raise HTTPException(status_code=404, detail="Target dataset not found")

    # Basic safety
    if "DROP" in req.sql_expression.upper() or "DELETE" in req.sql_expression.upper() or "UPDATE" in req.sql_expression.upper() or "INSERT" in req.sql_expression.upper():
        raise HTTPException(status_code=400, detail="Only SELECT expressions are allowed in metrics.")

    metric = Metric(
        product_id=req.product_id,
        metric_name=req.metric_name,
        logical_dataset_id=req.target_id if req.target_type == "logical" else None,
        dataset_id=req.target_id if req.target_type == "single" else None,
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
            "id": m.id,
            "metric_name": m.metric_name,
            "target_id": m.logical_dataset_id or m.dataset_id,
            "target_type": "logical" if m.logical_dataset_id else "single",
            "logical_dataset_id": m.logical_dataset_id,
            "dataset_id": m.dataset_id,
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

    table_name = None
    if metric.logical_dataset_id:
        ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == metric.logical_dataset_id)).scalars().first()
        if ld: table_name = ld.table_name
    elif metric.dataset_id:
        ds = db.execute(select(Dataset).where(Dataset.id == metric.dataset_id)).scalars().first()
        if ds: table_name = ds.table_name

    if not table_name:
        raise HTTPException(status_code=404, detail="Target table for metric not found")

    # Execute dynamic query on the materialized analytics table
    sql = f'SELECT {metric.sql_expression} AS "{metric.metric_name}" FROM "{table_name}"'
    
    try:
        result = query_dataset(engine, sql)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate metric: {str(e)}")

    return sanitize_nans({
        "metric_name": metric.metric_name,
        "value": result["rows"][0][metric.metric_name] if result["rows"] else None,
        "result_set": result["rows"]
    })


@router.get("/discover-metrics")
def discover_metrics(target_id: str, target_type: str = "logical", db: Session = Depends(get_db)):
    """
    Automatically discover business metrics for a logical dataset or single dataset using AI.
    """
    table_name = None
    dataset_name = None

    if target_type == "logical":
        ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == target_id)).scalars().first()
        if ld:
            table_name = ld.table_name
            dataset_name = ld.dataset_name
    else:
        ds = db.execute(select(Dataset).where(Dataset.id == target_id)).scalars().first()
        if ds:
            table_name = ds.table_name
            dataset_name = ds.file_name
    
    if not table_name:
        raise HTTPException(status_code=404, detail="Target dataset not found")

    # 1. Get column schema of the materialized table
    try:
        all_cols = get_table_columns(engine, table_name)
    except Exception:
        all_cols = []

    if not all_cols:
        raise HTTPException(
            status_code=400, 
            detail="Table not found or empty. Map some data first."
        )

    # 2. Get sample data (first 5 rows) to help AI understand the context
    sample_sql = f'SELECT * FROM "{table_name}" LIMIT 5'
    sample_res = query_dataset(engine, sample_sql)
    sample_data = sample_res["rows"]

    # 3. Call Gemini to suggest metrics
    try:
        suggestions = discover_metrics_with_ai(
            dataset_name=dataset_name,
            columns=all_cols,
            sample_data=sample_data
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI metric discovery failed: {str(e)}")

    return {
        "target_id": target_id,
        "target_type": target_type,
        "dataset_name": dataset_name,
        "suggested_metrics": suggestions
    }


# ── Post-Processing Analytics Pipeline Endpoints ─────────────────────────────

@router.get("/logical-datasets/{logical_dataset_id}/profile")
def get_logical_dataset_profile(logical_dataset_id: str, db: Session = Depends(get_db)):
    """Return the pre-computed statistical profile for each column of a LogicalDataset."""
    ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == logical_dataset_id)).scalars().first()
    if not ld:
        raise HTTPException(status_code=404, detail="Logical dataset not found")

    profiles = db.execute(
        select(DatasetProfile).where(DatasetProfile.logical_dataset_id == logical_dataset_id)
    ).scalars().all()

    if not profiles:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=202,
            content={"status": "pending", "message": "Profile not computed yet. It runs automatically after mapping."}
        )

    computed_at = profiles[0].computed_at.isoformat() if profiles[0].computed_at else None
    return {
        "logical_dataset_id": logical_dataset_id,
        "dataset_name": ld.dataset_name,
        "computed_at": computed_at,
        "columns": [
            {
                "column_name": p.column_name,
                "data_type": p.data_type,
                "row_count": p.row_count,
                "null_count": p.null_count,
                "null_pct": p.null_pct,
                "distinct_count": p.distinct_count,
                "min_value": p.min_value,
                "max_value": p.max_value,
                "mean_value": p.mean_value,
                "median_value": p.median_value,
                "std_dev": p.std_dev,
                "top_values": p.top_values or [],
            }
            for p in profiles
        ],
    }


@router.get("/logical-datasets/{logical_dataset_id}/anomalies")
def get_logical_dataset_anomalies(
    logical_dataset_id: str,
    column: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """Return flagged anomalies for a LogicalDataset, optionally filtered by column and severity."""
    ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == logical_dataset_id)).scalars().first()
    if not ld:
        raise HTTPException(status_code=404, detail="Logical dataset not found")

    query = select(DataAnomaly).where(DataAnomaly.logical_dataset_id == logical_dataset_id)
    if column:
        query = query.where(DataAnomaly.column_name == column)
    if severity:
        query = query.where(DataAnomaly.severity == severity)
    query = query.limit(min(limit, 2000))

    anomalies = db.execute(query).scalars().all()

    # Total count (unfiltered for summary)
    total = db.execute(
        select(DataAnomaly).where(DataAnomaly.logical_dataset_id == logical_dataset_id)
    ).scalars().all()

    return {
        "logical_dataset_id": logical_dataset_id,
        "dataset_name": ld.dataset_name,
        "total_anomalies": len(total),
        "anomalies": [
            {
                "id": a.id,
                "column_name": a.column_name,
                "row_index": a.row_index,
                "value": a.value,
                "method": a.method,
                "reason": a.reason,
                "severity": a.severity,
                "computed_at": a.computed_at.isoformat() if a.computed_at else None,
            }
            for a in anomalies
        ],
    }


@router.get("/logical-datasets/{logical_dataset_id}/trends")
def get_logical_dataset_trends(logical_dataset_id: str, db: Session = Depends(get_db)):
    """Return time-series trend analyses for numeric columns of a LogicalDataset."""
    ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == logical_dataset_id)).scalars().first()
    if not ld:
        raise HTTPException(status_code=404, detail="Logical dataset not found")

    trends = db.execute(
        select(TrendAnalysis).where(TrendAnalysis.logical_dataset_id == logical_dataset_id)
    ).scalars().all()

    # Check if profile exists but no trends (might mean no timestamp columns)
    profiles = db.execute(
        select(DatasetProfile).where(DatasetProfile.logical_dataset_id == logical_dataset_id)
    ).scalars().all()

    if not profiles:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=202,
            content={"status": "pending", "message": "Trend analysis not computed yet."}
        )

    time_col = trends[0].time_column if trends else None
    return {
        "logical_dataset_id": logical_dataset_id,
        "dataset_name": ld.dataset_name,
        "has_time_data": len(trends) > 0,
        "time_column": time_col,
        "trends": [
            {
                "value_column": t.value_column,
                "period": t.period,
                "direction": t.direction,
                "slope": t.slope,
                "r_squared": t.r_squared,
                "series_data": t.series_data or [],
            }
            for t in trends
        ],
    }


@router.get("/logical-datasets/{logical_dataset_id}/insight")
def get_logical_dataset_insight(logical_dataset_id: str, db: Session = Depends(get_db)):
    """Return the LLM-generated narrative insight for a LogicalDataset (read-only, cache-based)."""
    ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == logical_dataset_id)).scalars().first()
    if not ld:
        raise HTTPException(status_code=404, detail="Logical dataset not found")

    insight = db.execute(
        select(DatasetInsight).where(DatasetInsight.logical_dataset_id == logical_dataset_id)
    ).scalars().first()

    if not insight:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=202,
            content={"status": "pending", "message": "Insight generation in progress. This runs automatically after mapping."}
        )

    return {
        "logical_dataset_id": logical_dataset_id,
        "dataset_name": ld.dataset_name,
        "narrative": insight.narrative,
        "bullet_points": insight.bullet_points or [],
        "generated_at": insight.generated_at.isoformat() if insight.generated_at else None,
        "is_cached": True,
    }


class BulkMetricSaveRequest(BaseModel):
    product_id: str
    target_id: str
    target_type: str = "logical"
    metrics: list[dict] # Each dict: {metric_name, sql_expression, description}

@router.post("/metrics/bulk-save")
def bulk_save_metrics(req: BulkMetricSaveRequest, db: Session = Depends(get_db)):
    """Save multiple discovered metrics at once."""
    if req.target_type == "logical":
        target = db.execute(
            select(LogicalDataset).where(LogicalDataset.id == req.target_id, LogicalDataset.product_id == req.product_id)
        ).scalars().first()
    else:
        target = db.execute(
            select(Dataset).where(Dataset.id == req.target_id, Dataset.product_id == req.product_id)
        ).scalars().first()
    
    if not target:
        raise HTTPException(status_code=404, detail="Target dataset not found or product_id mismatch")

    saved_ids = []
    try:
        for m in req.metrics:
            metric = Metric(
                product_id=req.product_id,
                metric_name=m["metric_name"],
                logical_dataset_id=req.target_id if req.target_type == "logical" else None,
                dataset_id=req.target_id if req.target_type == "single" else None,
                sql_expression=m["sql_expression"],
                description=m.get("description"),
            )
            db.add(metric)
            db.flush() # flush to get ID
            saved_ids.append(metric.id)
        
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to save metrics: {str(e)}")

    return {"status": "success", "saved_count": len(saved_ids), "metric_ids": saved_ids}


# ── Per-File Analytics Endpoints ──────────────────────────────────────────────

@router.get("/datasets/{dataset_id}/profile")
def get_dataset_file_profile(dataset_id: str, db: Session = Depends(get_db)):
    """Return the pre-computed statistical profile for each column of a single uploaded file."""
    ds = db.execute(select(Dataset).where(Dataset.id == dataset_id)).scalars().first()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    profiles = db.execute(
        select(DatasetFileProfile).where(DatasetFileProfile.dataset_id == dataset_id)
    ).scalars().all()

    if not profiles:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=202,
            content={"status": "pending", "message": "Profile not computed yet. It runs automatically after upload."}
        )

    computed_at = profiles[0].computed_at.isoformat() if profiles[0].computed_at else None
    return {
        "dataset_id": dataset_id,
        "file_name": ds.file_name,
        "computed_at": computed_at,
        "columns": [
            {
                "column_name": p.column_name,
                "data_type": p.data_type,
                "row_count": p.row_count,
                "null_count": p.null_count,
                "null_pct": p.null_pct,
                "distinct_count": p.distinct_count,
                "min_value": p.min_value,
                "max_value": p.max_value,
                "mean_value": p.mean_value,
                "median_value": p.median_value,
                "std_dev": p.std_dev,
                "top_values": p.top_values or [],
            }
            for p in profiles
        ],
    }


@router.get("/datasets/{dataset_id}/anomalies")
def get_dataset_file_anomalies(
    dataset_id: str,
    column: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """Return flagged anomalies for a single uploaded file."""
    ds = db.execute(select(Dataset).where(Dataset.id == dataset_id)).scalars().first()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    query = select(DatasetFileAnomaly).where(DatasetFileAnomaly.dataset_id == dataset_id)
    if column:
        query = query.where(DatasetFileAnomaly.column_name == column)
    if severity:
        query = query.where(DatasetFileAnomaly.severity == severity)
    query = query.limit(min(limit, 1000))

    anomalies = db.execute(query).scalars().all()
    total_count = db.execute(
        select(DatasetFileAnomaly).where(DatasetFileAnomaly.dataset_id == dataset_id)
    ).scalars().all()

    return {
        "dataset_id": dataset_id,
        "file_name": ds.file_name,
        "total_anomalies": len(total_count),
        "anomalies": [
            {
                "id": a.id,
                "column_name": a.column_name,
                "row_index": a.row_index,
                "value": a.value,
                "method": a.method,
                "reason": a.reason,
                "severity": a.severity,
                "computed_at": a.computed_at.isoformat() if a.computed_at else None,
            }
            for a in anomalies
        ],
    }


@router.get("/datasets/{dataset_id}/insight")
def get_dataset_file_insight(dataset_id: str, db: Session = Depends(get_db)):
    """Return the LLM-generated narrative insight for a single uploaded file."""
    ds = db.execute(select(Dataset).where(Dataset.id == dataset_id)).scalars().first()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    insight = db.execute(
        select(DatasetFileInsight).where(DatasetFileInsight.dataset_id == dataset_id)
    ).scalars().first()

    if not insight:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=202,
            content={"status": "pending", "message": "File insight generation in progress."}
        )

    return {
        "dataset_id": dataset_id,
        "file_name": ds.file_name,
        "narrative": insight.narrative,
        "bullet_points": insight.bullet_points or [],
        "generated_at": insight.generated_at.isoformat() if insight.generated_at else None,
    }


# ── Quote / Value Comparison Engine ──────────────────────────────────────────

class CompareRequest(BaseModel):
    group_by: list[str]           # key columns to group rows by, e.g. ["size", "type"]
    pivot_on: str                 # dimension to compare across, e.g. "source_file" or "vendor"
    value_columns: list[str]      # columns to compare, e.g. ["price", "lead_time"]
    aggregation: str = "first"    # "first" | "min" | "max" | "avg"
    search: Optional[str] = None  # filter key rows by this string
    limit: int = 5000


def _execute_compare(table_name: str, req: CompareRequest):
    """Shared pivot/comparison logic used by both logical-dataset and target-schema compare endpoints."""
    from collections import defaultdict, OrderedDict

    # ── Column-based comparison mode ──────────────────────────────────────────
    # When pivot_on == "__columns__", each selected value_column IS a vendor dimension.
    # No JOIN needed; column names become the pivot values.
    if req.pivot_on == "__columns__" and req.value_columns:
        col_sql = f'SELECT * FROM "{table_name}" LIMIT {min(req.limit, 10000)}'
        try:
            col_result = query_dataset(engine, col_sql)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to query dataset: {str(e)}")

        col_rows = col_result.get("rows", [])
        if not col_rows:
            return sanitize_nans({
                "group_by": req.group_by, "pivot_on": req.pivot_on,
                "pivot_values": list(req.value_columns), "value_columns": ["value"],
                "aggregation": req.aggregation, "rows": [], "row_count": 0, "missing_coverage": {},
            })

        if req.search:
            s = req.search.lower()
            col_rows = [
                row for row in col_rows
                if any(s in str(row.get(col, "") or "").lower() for col in req.group_by)
            ]

        pivot_values = list(req.value_columns)
        col_key_to_pivot: "OrderedDict[tuple, dict]" = OrderedDict()
        col_key_to_dict: "dict[tuple, dict]" = {}

        for row in col_rows:
            key_tuple = tuple(str(row.get(col, "") or "") for col in req.group_by)
            if key_tuple not in col_key_to_pivot:
                col_key_to_pivot[key_tuple] = defaultdict(lambda: defaultdict(list))
                col_key_to_dict[key_tuple] = {col: str(row.get(col, "") or "") for col in req.group_by}
            for vc in pivot_values:
                val = row.get(vc)
                if val is not None and str(val).strip() not in ("", "None", "null"):
                    col_key_to_pivot[key_tuple][vc]["value"].append(val)

        def _agg_col(vals: list, agg: str):
            if not vals:
                return None
            numeric = []
            for v in vals:
                try:
                    numeric.append(float(v))
                except (ValueError, TypeError):
                    pass
            if agg == "first":
                return vals[0]
            if numeric:
                if agg == "min": return min(numeric)
                if agg == "max": return max(numeric)
                if agg == "avg": return round(sum(numeric) / len(numeric), 4)
            return vals[0]

        col_result_rows = []
        for key_tuple, pivot_dict in col_key_to_pivot.items():
            values: "dict[str, dict]" = {}
            for pv in pivot_values:
                vc_map = pivot_dict.get(pv, {})
                values[pv] = {"value": _agg_col(list(vc_map.get("value", [])), req.aggregation)}

            best: "dict[str, str]" = {}
            entries = []
            for pv in pivot_values:
                v = values[pv]["value"]
                if v is not None and str(v).strip() not in ("", "None"):
                    try:
                        fval = float(v)
                        if not __import__("math").isnan(fval):
                            entries.append((pv, fval))
                    except (ValueError, TypeError):
                        pass
            if len(entries) > 1:
                winner = max(entries, key=lambda x: x[1]) if req.aggregation == "max" else min(entries, key=lambda x: x[1])
                best["value"] = winner[0]

            col_result_rows.append({"key": col_key_to_dict[key_tuple], "values": values, "best": best})

        col_missing: "dict[str, int]" = {}
        for pv in pivot_values:
            missing = sum(1 for row in col_result_rows if row["values"].get(pv, {}).get("value") is None)
            if missing:
                col_missing[pv] = missing

        return sanitize_nans({
            "group_by": req.group_by, "pivot_on": req.pivot_on,
            "pivot_values": pivot_values, "value_columns": ["value"],
            "aggregation": req.aggregation, "rows": col_result_rows,
            "row_count": len(col_result_rows), "missing_coverage": col_missing,
        })
    # ── end __columns__ mode ──────────────────────────────────────────────────

    sql = f"""
        SELECT COALESCE(d.file_name, t.dataset_id::text) AS source_file, t.*
        FROM "{table_name}" t
        LEFT JOIN datasets d ON t.dataset_id = d.id
        LIMIT {min(req.limit, 10000)}
    """
    try:
        result = query_dataset(engine, sql)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query dataset: {str(e)}")

    rows = result.get("rows", [])
    if not rows:
        return sanitize_nans({
            "group_by": req.group_by,
            "pivot_on": req.pivot_on,
            "pivot_values": [],
            "value_columns": req.value_columns,
            "aggregation": req.aggregation,
            "rows": [],
            "row_count": 0,
            "missing_coverage": {},
        })

    # Apply search filter across group_by + pivot_on columns
    if req.search:
        s = req.search.lower()
        rows = [
            row for row in rows
            if any(
                s in str(row.get(col, "") or "").lower()
                for col in req.group_by + [req.pivot_on]
            )
        ]

    # Pivot: key_tuple → pivot_value → value_col → [raw values]
    key_to_pivot: "OrderedDict[tuple, dict]" = OrderedDict()
    key_to_dict: "dict[tuple, dict]" = {}

    for row in rows:
        key_tuple = tuple(str(row.get(col, "") or "") for col in req.group_by)
        pivot_val = str(row.get(req.pivot_on, "") or "").strip() or "(unknown)"

        if key_tuple not in key_to_pivot:
            key_to_pivot[key_tuple] = defaultdict(lambda: defaultdict(list))
            key_to_dict[key_tuple] = {col: str(row.get(col, "") or "") for col in req.group_by}

        for vc in req.value_columns:
            val = row.get(vc)
            if val is not None and str(val).strip() not in ("", "None", "null"):
                key_to_pivot[key_tuple][pivot_val][vc].append(val)

    # Collect pivot dimension values in sorted order
    seen_pv: "set[str]" = set()
    pivot_values: "list[str]" = []
    for pivot_dict in key_to_pivot.values():
        for pv in pivot_dict:
            if pv not in seen_pv:
                pivot_values.append(pv)
                seen_pv.add(pv)
    pivot_values.sort()

    def _agg(vals: list, agg: str):
        if not vals:
            return None
        numeric = []
        for v in vals:
            try:
                numeric.append(float(v))
            except (ValueError, TypeError):
                pass
        if agg == "first":
            return vals[0]
        if numeric:
            if agg == "min":
                return min(numeric)
            if agg == "max":
                return max(numeric)
            if agg == "avg":
                return round(sum(numeric) / len(numeric), 4)
        return vals[0]

    result_rows = []
    for key_tuple, pivot_dict in key_to_pivot.items():
        # Aggregate values per (pivot_value, value_col) cell
        values: "dict[str, dict]" = {}
        for pv in pivot_values:
            vc_map = pivot_dict.get(pv, {})
            values[pv] = {
                vc: _agg(list(vc_map.get(vc, [])), req.aggregation)
                for vc in req.value_columns
            }

        # Determine best pivot value per value column (for numeric columns)
        best: "dict[str, str]" = {}
        for vc in req.value_columns:
            entries = []
            for pv, vc_vals in values.items():
                v = vc_vals.get(vc)
                if v is not None:
                    try:
                        entries.append((pv, float(v)))
                    except (ValueError, TypeError):
                        pass
            if len(entries) > 1:
                # max aggregation → higher is better; everything else → lower is better
                winner = max(entries, key=lambda x: x[1]) if req.aggregation == "max" else min(entries, key=lambda x: x[1])
                best[vc] = winner[0]

        result_rows.append({
            "key": key_to_dict[key_tuple],
            "values": values,
            "best": best,
        })

    # Coverage gaps: how many key rows a given pivot value is missing entirely
    missing_coverage: "dict[str, int]" = {}
    for pv in pivot_values:
        missing = sum(
            1 for row in result_rows
            if all(row["values"].get(pv, {}).get(vc) is None for vc in req.value_columns)
        )
        if missing:
            missing_coverage[pv] = missing

    return sanitize_nans({
        "group_by": req.group_by,
        "pivot_on": req.pivot_on,
        "pivot_values": pivot_values,
        "value_columns": req.value_columns,
        "aggregation": req.aggregation,
        "rows": result_rows,
        "row_count": len(result_rows),
        "missing_coverage": missing_coverage,
    })


@router.post("/logical-datasets/{logical_dataset_id}/compare")
def compare_logical_dataset(
    logical_dataset_id: str,
    req: CompareRequest,
    db: Session = Depends(get_db),
):
    ld = db.execute(
        select(LogicalDataset).where(LogicalDataset.id == logical_dataset_id)
    ).scalars().first()
    if not ld:
        raise HTTPException(status_code=404, detail="Logical dataset not found")
    return _execute_compare(ld.table_name, req)


@router.post("/target-schemas/{schema_id}/compare")
def compare_target_schema(
    schema_id: str,
    req: CompareRequest,
    db: Session = Depends(get_db),
):
    schema = db.execute(
        select(TargetSchema).where(TargetSchema.id == schema_id)
    ).scalars().first()
    if not schema:
        raise HTTPException(status_code=404, detail="Target schema not found")
    table_name = f"mapped_{str(schema.id).replace('-', '_')}"
    return _execute_compare(table_name, req)


# ── AI-Powered Comparison Assistance ─────────────────────────────────────────

class SuggestCompareRequest(BaseModel):
    columns: list  # [{"key": "price", "data_type": "text"}, ...]
    schema_name: str


@router.post("/suggest-comparison")
def suggest_comparison_config(req: SuggestCompareRequest):
    from ..services.gemini import suggest_comparison_config_with_ai
    result = suggest_comparison_config_with_ai(req.schema_name, req.columns)
    if not result:
        raise HTTPException(status_code=503, detail="AI suggestion unavailable")
    return result


class CompareNarrativeRequest(BaseModel):
    schema_name: str
    pivot_values: list[str]      # vendor names
    value_columns: list[str]
    aggregation: str
    vendor_stats: dict           # {vendor: {col: {min, max, avg, count}}}
    best_vendor: dict            # {col: vendor_name}
    row_count: int
    coverage_stats: dict         # {vendor: missing_count}


@router.post("/compare-narrative")
def compare_narrative(req: CompareNarrativeRequest):
    from ..services.gemini import generate_comparison_narrative_with_ai
    summary = req.model_dump()
    result = generate_comparison_narrative_with_ai(req.schema_name, summary)
    if not result:
        raise HTTPException(status_code=503, detail="AI narrative unavailable")
    return result
