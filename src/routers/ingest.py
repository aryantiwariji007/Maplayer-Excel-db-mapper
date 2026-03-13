"""
ingest.py
─────────────────────────────────────────────
REST API endpoints for the Dynamic Schema Ingestion Platform.

Endpoints:
  POST /ingest/upload               → ingest any file, auto-create schema + table
  GET  /datasets                    → list datasets for a product
  GET  /datasets/{dataset_id}       → get a single dataset's metadata
  DELETE /datasets/{dataset_id}     → drop a dataset and its table
  POST /dataset/map                 → assign dataset to a logical dataset
  GET  /logical-datasets            → list logical datasets for a product
  POST /logical-datasets            → create a new logical dataset
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from typing import Optional, Annotated
import uuid

from ..database import get_db, engine
from ..models import (
    Dataset,
    DatasetColumn,
    DatasetVersion,
    LogicalDataset,
    LogicalDatasetMapping,
)
from ..services.data_processor import load_dataframe
from ..services.schema_inference import infer_schema
from ..services.dataset_store import (
    create_dataset_table, 
    insert_dataset_rows, 
    drop_dataset_table,
    create_analytics_table,
    append_to_analytics_table,
    get_table_columns,
    add_columns_to_analytics_table
)
from ..services.schema_inference import pg_type
from ..services.similarity import suggest_logical_dataset

router = APIRouter()

class MapDatasetRequest(BaseModel):
    dataset_id: str
    logical_dataset_id: str
    column_mapping: dict  # {"source_normalized_col": "logical_col"}

def perform_mapping(req: MapDatasetRequest, db: Session):
    """Internal helper to avoid cyclic or premature endpoint calls."""
    dataset = db.execute(select(Dataset).where(Dataset.id == req.dataset_id)).scalars().first()
    if not dataset:
        raise Exception("Dataset not found")

    ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == req.logical_dataset_id)).scalars().first()
    if not ld:
        raise Exception("Logical dataset not found")

    mapping = LogicalDatasetMapping(
        logical_dataset_id=req.logical_dataset_id,
        dataset_id=req.dataset_id,
        column_mapping=req.column_mapping,
    )
    db.add(mapping)
    
    # ── Materialize into Analytics Table ──
    cols = db.execute(
        select(DatasetColumn).where(DatasetColumn.dataset_id == req.dataset_id)
    ).scalars().all()
    
    source_columns = [
        {
            "column_name": c.column_name,
            "normalized_name": c.normalized_name,
            "pg_type": pg_type(c.data_type)
        } 
        for c in cols
    ]

    try:
        existing_cols = get_table_columns(engine, ld.table_name)
        new_cols_to_add = {}
        # Simple type map construction for the evolution check
        type_map = {c.normalized_name: pg_type(c.data_type) for c in cols}
        
        for source_col, target_col in req.column_mapping.items():
            if target_col not in existing_cols:
                new_cols_to_add[target_col] = type_map.get(source_col, "TEXT")
        
        if new_cols_to_add:
            add_columns_to_analytics_table(engine, ld.table_name, new_cols_to_add)
    except Exception:
        create_analytics_table(engine, ld.table_name, req.column_mapping, source_columns)
    
    append_to_analytics_table(engine, ld.table_name, dataset.table_name, req.column_mapping, req.dataset_id)
    db.commit()

@router.post("/upload")
async def ingest_upload(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    product_id: Optional[str] = Form(None),
    product_id_alt: Optional[str] = Form(None, alias="product-id"),
    auto_map: bool = Form(False),
):
    # Use either underscore or hyphen version
    final_product_id = product_id or product_id_alt
    
    print(f"\n>>> INGEST ATTEMPT: product_id={final_product_id}, file={file.filename} <<<")
    
    if not final_product_id:
         raise HTTPException(status_code=422, detail="product_id (or product-id) is required")
    
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    # Step 1 — Parse file with smart header detection
    try:
        df = load_dataframe(content, file.filename)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"File Processing Error: {str(e)}")

    if df.empty or len(df.columns) == 0:
        raise HTTPException(status_code=422, detail="File contains no usable data after header detection")

    # Step 2 — Infer schema
    schema_meta = infer_schema(df, final_product_id, file.filename)
    dataset_meta = schema_meta["dataset"]
    columns_meta = schema_meta["columns"]

    # Step 3 — Create dynamic table in Postgres
    try:
        create_dataset_table(engine, dataset_meta["table_name"], columns_meta)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create dataset table: {str(e)}")

    # Step 4 — Insert rows
    try:
        rows_inserted = insert_dataset_rows(engine, dataset_meta["table_name"], df, columns_meta)
    except Exception as e:
        import traceback
        traceback.print_exc()
        drop_dataset_table(engine, dataset_meta["table_name"])
        raise HTTPException(status_code=500, detail=f"Failed to insert data: {str(e)}")

    # Step 5 — Persist metadata to registry
    db_dataset = Dataset(
        id=dataset_meta["id"],
        product_id=final_product_id,
        file_name=dataset_meta["file_name"],
        table_name=dataset_meta["table_name"],
        row_count=rows_inserted,
    )
    db.add(db_dataset)

    for col in columns_meta:
        db.add(DatasetColumn(
            dataset_id=dataset_meta["id"],
            column_name=col["column_name"],
            normalized_name=col["normalized_name"],
            data_type=col["data_type"],
        ))

    # Dataset version 1
    db.add(DatasetVersion(
        dataset_id=dataset_meta["id"],
        version=1,
        table_name=dataset_meta["table_name"],
    ))

    db.commit()

    # Step 6 — Suggest logical datasets
    col_dicts = [{"normalized_name": c["normalized_name"], "data_type": c["data_type"]} for c in columns_meta]
    try:
        suggestions = suggest_logical_dataset(db, col_dicts, final_product_id)
    except Exception:
        suggestions = []

    # Step 7 — Proactive Auto-Mapping (AI-powered)
    auto_mapped = False
    if auto_map and suggestions and suggestions[0]["similarity_score"] > 0.85:
        best = suggestions[0]
        try:
            map_req = MapDatasetRequest(
                dataset_id=dataset_meta["id"],
                logical_dataset_id=best["logical_dataset_id"],
                column_mapping=best["suggested_mapping"]
            )
            perform_mapping(map_req, db)
            auto_mapped = True
        except Exception as e:
            print(f"DEBUG: Auto-mapping failed: {e}")

    return {
        "dataset_id": dataset_meta["id"],
        "table_name": dataset_meta["table_name"],
        "rows": rows_inserted,
        "columns": [
            {
                "name": c["normalized_name"],
                "type": c["data_type"],
            }
            for c in columns_meta
        ],
        "status": "success",
        "file_name": file.filename,
        "logical_dataset_suggestions": suggestions,
        "auto_mapped": auto_mapped,
        "mapped_to": suggestions[0]["logical_dataset_name"] if auto_mapped else None
    }


# ── Dataset Registry ─────────────────────────────────────────────────────────

@router.get("/datasets")
def list_datasets(product_id: str, db: Session = Depends(get_db)):
    """List all ingested datasets for a product."""
    datasets = db.execute(
        select(Dataset).where(Dataset.product_id == product_id).order_by(Dataset.created_at.desc())
    ).scalars().all()

    return [
        {
            "dataset_id": d.id,
            "file_name": d.file_name,
            "table_name": d.table_name,
            "row_count": d.row_count,
            "created_at": d.created_at,
        }
        for d in datasets
    ]


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str, db: Session = Depends(get_db)):
    """Get full metadata for a single dataset including its schema."""
    dataset = db.execute(select(Dataset).where(Dataset.id == dataset_id)).scalars().first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    cols = db.execute(
        select(DatasetColumn).where(DatasetColumn.dataset_id == dataset_id)
    ).scalars().all()

    return {
        "dataset_id": dataset.id,
        "product_id": dataset.product_id,
        "file_name": dataset.file_name,
        "table_name": dataset.table_name,
        "row_count": dataset.row_count,
        "created_at": dataset.created_at,
        "columns": [
            {
                "column_name": c.column_name,
                "normalized_name": c.normalized_name,
                "data_type": c.data_type,
            }
            for c in cols
        ],
    }


@router.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: str, db: Session = Depends(get_db)):
    """Delete dataset metadata and drop its physical table."""
    dataset = db.execute(select(Dataset).where(Dataset.id == dataset_id)).scalars().first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    table_name = dataset.table_name
    db.delete(dataset)
    db.commit()

    try:
        drop_dataset_table(engine, table_name)
    except Exception as e:
        return {"status": "metadata_deleted", "warning": f"Could not drop table: {str(e)}"}

    return {"status": "deleted", "table_name": table_name}


# ── Logical Dataset Management ────────────────────────────────────────────────

class CreateLogicalDatasetRequest(BaseModel):
    product_id: str
    dataset_name: str
    description: Optional[str] = None


@router.post("/logical-datasets")
def create_logical_dataset(req: CreateLogicalDatasetRequest, db: Session = Depends(get_db)):
    """Create a new named logical dataset (grouping concept)."""
    existing = db.execute(
        select(LogicalDataset).where(
            LogicalDataset.product_id == req.product_id,
            LogicalDataset.dataset_name == req.dataset_name,
        )
    ).scalars().first()
    if existing:
        raise HTTPException(status_code=400, detail="Logical dataset already exists")

    table_name = f"analytics_{str(uuid.uuid4()).replace('-', '_')}"
    ld = LogicalDataset(
        product_id=req.product_id,
        dataset_name=req.dataset_name,
        description=req.description,
        table_name=table_name
    )
    db.add(ld)
    db.commit()
    db.refresh(ld)

    return {"logical_dataset_id": ld.id, "dataset_name": ld.dataset_name, "table_name": ld.table_name}


@router.get("/logical-datasets")
def list_logical_datasets(product_id: str, db: Session = Depends(get_db)):
    """List all logical datasets for a product."""
    lds = db.execute(
        select(LogicalDataset).where(LogicalDataset.product_id == product_id)
    ).scalars().all()
    return [
        {"logical_dataset_id": ld.id, "dataset_name": ld.dataset_name, "description": ld.description}
        for ld in lds
    ]


@router.post("/dataset/map")
def map_dataset_to_logical(req: MapDatasetRequest, db: Session = Depends(get_db)):
    """
    Assign a physical dataset to a logical dataset with an explicit column mapping.
    E.g. {"value": "temperature", "time": "timestamp"}
    """
    try:
        perform_mapping(req, db)
        return {
            "status": "mapped and materialized",
            "dataset_id": req.dataset_id,
            "column_mapping": req.column_mapping,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
