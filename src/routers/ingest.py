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
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session
from typing import Optional, Annotated, List
import uuid
import pandas as pd

from ..database import get_db, engine
from ..models import (
    Dataset,
    DatasetColumn,
    DatasetVersion,
    LogicalDataset,
    LogicalDatasetMapping,
    TargetSchema,
    TargetColumn,
    UploadJob,
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
    add_columns_to_analytics_table,
    query_dataset
)
from ..services.schema_inference import pg_type
from ..services.similarity import suggest_logical_dataset
from ..utils.json_utils import sanitize_nans

router = APIRouter()

class MapDatasetRequest(BaseModel):
    dataset_id: str
    logical_dataset_id: str
    column_mapping: Optional[dict] = None  # Optional if auto_map is true
    auto_map: bool = False

def perform_mapping(req: MapDatasetRequest, db: Session):
    """Internal helper to avoid cyclic or premature endpoint calls."""
    dataset = db.execute(select(Dataset).where(Dataset.id == req.dataset_id)).scalars().first()
    if not dataset:
        raise Exception("Dataset not found")

    ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == req.logical_dataset_id)).scalars().first()
    if not ld:
        raise Exception("Logical dataset not found")

    if req.auto_map and not req.column_mapping:
        from ..services.similarity import get_logical_schema_columns, generate_suggested_mapping
        
        cols = db.execute(select(DatasetColumn).where(DatasetColumn.dataset_id == req.dataset_id)).scalars().all()
        source_cols = [c.normalized_name for c in cols]
        
        # Get target schema columns for the specific logical dataset
        ld_target_keys = get_logical_schema_columns(db, ld.id)
        
        if ld_target_keys:
            # Generate mapping directly against the known target schema
            req.column_mapping = generate_suggested_mapping(
                source_cols,
                ld_target_keys,
                schema_description=ld.description
            )
        else:
            # Identity mapping fallback (first file case)
            req.column_mapping = {c: c for c in source_cols}

    if req.column_mapping is None:
        if req.auto_map:
            raise Exception("Auto-map failed to identify any matching columns between the source file and logical schema. Please provide a manual column_mapping.")
        raise Exception("Column mapping is required")

    # Filter out empty/skipped target keys to prevent SQL syntax errors ("" TEXT)
    req.column_mapping = {
        src: tgt for src, tgt in req.column_mapping.items() 
        if tgt and tgt.strip() and tgt != "- skip -"
    }
    
    if not req.column_mapping:
        raise Exception("No valid columns selected for mapping. Please map at least one column.")

    existing_mapping = db.execute(
        select(LogicalDatasetMapping).where(LogicalDatasetMapping.dataset_id == req.dataset_id)
    ).scalars().first()
    
    if existing_mapping:
        # Archive old mapping to history before overwriting
        from ..models import MappingHistory
        import datetime
        history_record = MappingHistory(
            dataset_id=existing_mapping.dataset_id,
            logical_dataset_id=existing_mapping.logical_dataset_id,
            column_mapping=existing_mapping.column_mapping,
            version=existing_mapping.version,
            superseded_at=datetime.datetime.utcnow(),
        )
        db.add(history_record)
        
        # Delete old rows from existing analytics table
        old_ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == existing_mapping.logical_dataset_id)).scalars().first()
        if old_ld:
            try:
                with engine.begin() as conn:
                    conn.execute(text(f'DELETE FROM "{old_ld.table_name}" WHERE dataset_id = :did'), {"did": req.dataset_id})
            except Exception as e:
                print(f"DEBUG: Failed to delete old mapped rows: {e}")
                
        existing_mapping.logical_dataset_id = req.logical_dataset_id
        existing_mapping.column_mapping = req.column_mapping
        existing_mapping.version = (existing_mapping.version or 1) + 1
    else:
        mapping = LogicalDatasetMapping(
            logical_dataset_id=req.logical_dataset_id,
            dataset_id=req.dataset_id,
            column_mapping=req.column_mapping,
            version=1,
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
        from ..services.dataset_store import get_table_schema_dict, promote_column_type
        existing_cols_dict = get_table_schema_dict(engine, ld.table_name)
        new_cols_to_add = {}
        # Simple type map construction for the evolution check
        type_map = {c.normalized_name: pg_type(c.data_type) for c in cols}
        
        for source_col, target_col in req.column_mapping.items():
            source_pg_type = type_map.get(source_col, "TEXT")
            
            if target_col not in existing_cols_dict:
                new_cols_to_add[target_col] = source_pg_type
            else:
                target_pg_type = existing_cols_dict[target_col].upper()
                # Type Promotion: If source is TEXT but target is restrictive, promote to TEXT
                if source_pg_type == "TEXT" and "TEXT" not in target_pg_type and "VARCHAR" not in target_pg_type:
                    promote_column_type(engine, ld.table_name, target_col, "TEXT")
                    print(f"DEBUG: Promoted target column '{target_col}' in '{ld.table_name}' from {target_pg_type} to TEXT.")
        
        if new_cols_to_add:
            add_columns_to_analytics_table(engine, ld.table_name, new_cols_to_add)
    except Exception as e:
        print(f"DEBUG: Analytics evolution failed or table missing: {e}. Attempting full create.")
        create_analytics_table(engine, ld.table_name, req.column_mapping, source_columns)
    
    append_to_analytics_table(engine, ld.table_name, dataset.table_name, req.column_mapping, req.dataset_id)
    db.commit()

    # ── Dispatch Post-Processing Analytics Pipeline ──
    try:
        from ..celery_app import (
            profile_logical_dataset,
            detect_anomalies,
            detect_trends,
            generate_narrative_insight,
        )
        from celery import chain as celery_chain
        celery_chain(
            profile_logical_dataset.s(req.logical_dataset_id),
            detect_anomalies.s(req.logical_dataset_id),
            detect_trends.s(req.logical_dataset_id),
            generate_narrative_insight.s(req.logical_dataset_id),
        ).delay()
    except Exception as e:
        print(f"DEBUG: Failed to dispatch analytics pipeline for {req.logical_dataset_id}: {e}")

    # ── Fetch Samples for Feedback ──
    # Invert mapping for the UI feedback (showing logical -> physical)
    inverted_map = {v: k for k, v in req.column_mapping.items()}
    
    result = {
        "detected_schema": ld.dataset_name,
        "logical_dataset_id": ld.id,
        "mappings_used": len(req.column_mapping),
        "target_to_source_map": inverted_map,
        "sample_input_records": [],
        "transformed_rows": []
    }
    
    try:
        raw_sample = query_dataset(engine, f'SELECT * FROM "{dataset.table_name}" LIMIT 5')
        result["sample_input_records"] = raw_sample["rows"]
        
        # Querying the analytics table for this dataset
        transformed_sample = query_dataset(engine, f'SELECT * FROM "{ld.table_name}" WHERE dataset_id = \'{req.dataset_id}\' LIMIT 5')
        result["transformed_rows"] = transformed_sample["rows"]
        
    except Exception as e:
        # We don't want to crash the whole mapping if just the feedback query fails
        # but we do want to know why.
        print(f"DEBUG: Feedback Sample Query Failed for {ld.table_name}: {e}")
        result["feedback_error"] = str(e)
        
    return result

@router.post("/upload")
async def ingest_upload(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    product_id: Optional[str] = Form(None),
    product_id_alt: Optional[str] = Form(None, alias="product-id"),
    auto_map: bool = Form(False),
    logical_dataset_name: Optional[str] = Form(None),
):
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
        # schema_type and mapped_schema_name filled in after resolution below
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

    # Step 6 — Extract columns and sample data for schema resolution
    col_dicts = [{"normalized_name": c["normalized_name"], "data_type": c["data_type"]} for c in columns_meta]
    sample_data = df.head(5).where(pd.notna(df.head(5)), None).to_dict(orient="records")

    # Step 7 — Auto-Map: Unified Schema Resolution (Static + Dynamic)
    auto_mapped = False
    schema_type = None
    mapped_schema_name = None
    mapped_schema_id = None
    match_confidence = 0.0
    column_mapping_used = {}

    if auto_map or logical_dataset_name:
        try:
            from ..services.schema_resolver import resolve_best_schema, SchemaMatch
            from ..services.materialization import ensure_static_table, ensure_dynamic_table, append_rows
            
            # Determine which target to force (if user specified a logical dataset name)
            forced_ld = None
            if logical_dataset_name:
                forced_ld = db.execute(select(LogicalDataset).where(
                    LogicalDataset.product_id == final_product_id,
                    LogicalDataset.dataset_name == logical_dataset_name
                )).scalars().first()
                if not forced_ld:
                    analytics_tbl = f"analytics_{str(uuid.uuid4()).replace('-', '_')}"
                    forced_ld = LogicalDataset(
                        product_id=final_product_id,
                        dataset_name=logical_dataset_name,
                        table_name=analytics_tbl
                    )
                    db.add(forced_ld)
                    db.commit()
                    db.refresh(forced_ld)

            if forced_ld:
                # User explicitly targeted a dynamic schema — skip resolver, use it directly
                from ..services.similarity import get_logical_schema_columns, generate_suggested_mapping
                ld_cols = get_logical_schema_columns(db, forced_ld.id)
                if ld_cols:
                    col_mapping = generate_suggested_mapping(
                        [c["normalized_name"] for c in col_dicts],
                        ld_cols,
                        sample_data=sample_data
                    )
                else:
                    col_mapping = {c["normalized_name"]: c["normalized_name"] for c in col_dicts}
                
                match = SchemaMatch(
                    schema_type="dynamic",
                    logical_dataset_id=forced_ld.id,
                    schema_name=forced_ld.dataset_name,
                    confidence=1.0,
                    column_mapping=col_mapping,
                    analytics_table=forced_ld.table_name,
                    reason="User-specified target schema"
                )
            else:
                # Unified AI resolution across all schemas
                match = resolve_best_schema(
                    db=db,
                    source_columns=col_dicts,
                    sample_data=sample_data,
                    product_id=final_product_id,
                )

            if match.schema_type != "none" and match.column_mapping:
                source_cols_for_mat = [
                    {"normalized_name": c["normalized_name"], "pg_type": pg_type(c["data_type"])}
                    for c in columns_meta
                ]

                if match.schema_type == "static":
                    ensure_static_table(engine, match.analytics_table, match.column_mapping, source_cols_for_mat)
                else:
                    ensure_dynamic_table(engine, match.analytics_table, match.column_mapping, source_cols_for_mat)

                append_rows(engine, match.analytics_table, dataset_meta["table_name"], match.column_mapping, dataset_meta["id"])

                # Record the mapping
                ld_for_record = None
                if match.schema_type == "dynamic":
                    ld_for_record = db.execute(select(LogicalDataset).where(
                        LogicalDataset.id == match.logical_dataset_id
                    )).scalars().first()
                    if ld_for_record:
                        db.add(LogicalDatasetMapping(
                            logical_dataset_id=ld_for_record.id,
                            dataset_id=dataset_meta["id"],
                            column_mapping=match.column_mapping,
                        ))
                        db.commit()

                auto_mapped = True
                schema_type = match.schema_type
                mapped_schema_name = match.schema_name
                mapped_schema_id = match.schema_id or match.logical_dataset_id
                match_confidence = match.confidence
                column_mapping_used = match.column_mapping

                # ── Ensure Logical Mapping Link ──
                # If name matches a LogicalDataset for this product, always create a mapping link 
                # so it appears in the Preview > Logical tree, regardless of whether type is static or dynamic.
                ld_match = db.execute(select(LogicalDataset).where(
                    LogicalDataset.product_id == final_product_id,
                    LogicalDataset.dataset_name == mapped_schema_name
                )).scalars().first()
                if ld_match:
                    # Check if mapping already exists
                    existing_m = db.execute(select(LogicalDatasetMapping).where(
                        LogicalDatasetMapping.dataset_id == dataset_meta["id"],
                        LogicalDatasetMapping.logical_dataset_id == ld_match.id
                    )).scalars().first()
                    if not existing_m:
                        db.add(LogicalDatasetMapping(
                            logical_dataset_id=ld_match.id,
                            dataset_id=dataset_meta["id"],
                            column_mapping=column_mapping_used,
                        ))
                        db.commit()

                # Persist schema_type and mapping on the dataset record for future queries
                db_dataset.schema_type = schema_type
                db_dataset.mapped_schema_name = mapped_schema_name
                db_dataset.column_mapping = column_mapping_used
                db.add(db_dataset)
                db.commit()
                print(f"DEBUG: Auto-mapped to {schema_type} schema '{mapped_schema_name}' (confidence={match_confidence:.2f})")


        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"DEBUG: Auto-mapping failed: {e}")

    # Step 7b — Dispatch per-file analytics pipeline
    try:
        from ..celery_app import profile_single_dataset, detect_single_dataset_anomalies, generate_single_dataset_narrative
        from celery import chain as celery_chain
        celery_chain(
            profile_single_dataset.s(dataset_meta["id"]),
            detect_single_dataset_anomalies.s(dataset_meta["id"]),
            generate_single_dataset_narrative.s(dataset_meta["id"]),
        ).delay()
    except Exception as e:
        print(f"DEBUG: Failed to dispatch file analytics pipeline for {dataset_meta['id']}: {e}")

    # Step 8 — Build suggestions for informational response
    try:
        suggestions = suggest_logical_dataset(db, col_dicts, final_product_id, sample_data=sample_data)
    except Exception:
        suggestions = []

    res_data = {
        "dataset_id": dataset_meta["id"],
        "table_name": dataset_meta["table_name"],
        "rows": rows_inserted,
        "columns": [{"name": c["normalized_name"], "type": c["data_type"]} for c in columns_meta],
        "status": "success",
        "file_name": file.filename,
        "auto_mapped": auto_mapped,
        "schema_type": schema_type,
        "mapped_to": mapped_schema_name,
        "mapped_schema_id": mapped_schema_id,
        "match_confidence": match_confidence,
        "column_mapping": column_mapping_used,
        "logical_dataset_suggestions": suggestions,
    }

    return sanitize_nans(res_data)

@router.post("/upload-bulk")
async def ingest_upload_bulk(
    product_id: Annotated[str, Form()],
    auto_map: Annotated[bool, Form()] = False,
    logical_dataset_name: Annotated[Optional[str], Form()] = None,
    files: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    import os

    if not files:
        raise HTTPException(status_code=400, detail="Must provide at least one file (CSV, Excel, or ZIP)")

    # 1. Create a job record
    job = UploadJob(
        product_id=product_id,
        status="PENDING",
        total_files=0,  # Background worker determines count after ZIP extraction
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # 2. Save uploaded files to temp directory using async reads
    #    (shutil.copyfileobj is unsafe here — SpooledTemporaryFile pointer may be at EOF)
    temp_dir = os.path.join("storage", "temp_uploads", job.id)
    os.makedirs(temp_dir, exist_ok=True)

    for f in files:
        content = await f.read()
        if not content:
            continue
        safe_filename = os.path.basename(f.filename or "upload")
        target_path = os.path.join(temp_dir, safe_filename)
        with open(target_path, "wb") as out:
            out.write(content)

    # 3. Dispatch Celery Task
    from ..celery_app import process_ingestion_job
    process_ingestion_job.delay(
        job_id=job.id,
        product_id=product_id,
        auto_map=auto_map,
        logical_dataset_name=logical_dataset_name,
    )

    return {"status": "accepted", "job_id": job.id, "message": "Files queued for bulk processing."}

@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str, db: Session = Depends(get_db)):
    job = db.query(UploadJob).filter(UploadJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {
        "id": job.id,
        "status": job.status,
        "total_files": job.total_files,
        "processed_files": job.processed_files,
        "results": job.results,
        "error": job.error_message,
        "updated_at": job.updated_at
    }




# ── Dataset Registry ─────────────────────────────────────────────────────────

@router.get("/datasets")
def list_datasets(product_id: str, db: Session = Depends(get_db)):
    """List all ingested datasets for a product."""
    datasets = db.execute(
        select(Dataset).where(Dataset.product_id == product_id).order_by(Dataset.created_at.desc())
    ).scalars().all()

    results = []
    for d in datasets:
        # Get column names
        cols = db.execute(select(DatasetColumn.normalized_name).where(DatasetColumn.dataset_id == d.id)).scalars().all()
        
        # Get logical mapping
        mapping = db.execute(select(LogicalDatasetMapping).where(LogicalDatasetMapping.dataset_id == d.id)).scalars().first()
        ld_name = None
        ld_id = None
        if mapping:
            ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == mapping.logical_dataset_id)).scalars().first()
            if ld:
                ld_name = ld.dataset_name
                ld_id = ld.id

        results.append({
            "id": d.id,
            "original_filename": d.file_name,
            "table_name": d.table_name,
            "row_count": d.row_count,
            "created_at": d.created_at,
            "columns": list(cols),
            "logical_dataset_id": ld_id,
            "logical_dataset_name": ld_name or d.mapped_schema_name,
            "schema_type": d.schema_type,
        })

    return results


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
        "id": dataset.id,
        "product_id": dataset.product_id,
        "original_filename": dataset.file_name,
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

    return {"id": ld.id, "dataset_name": ld.dataset_name, "table_name": ld.table_name, "created_at": ld.created_at}


@router.get("/logical-datasets")
def list_logical_datasets(product_id: str, db: Session = Depends(get_db)):
    """List all logical datasets for a product."""
    lds = db.execute(
        select(LogicalDataset).where(LogicalDataset.product_id == product_id)
    ).scalars().all()
    return [
        {"id": ld.id, "dataset_name": ld.dataset_name, "table_name": ld.table_name, "description": ld.description, "created_at": ld.created_at}
        for ld in lds
    ]


@router.get("/logical-datasets/{logical_dataset_id}/source-files")
def list_logical_dataset_source_files(logical_dataset_id: str, db: Session = Depends(get_db)):
    """
    List all physical source files (datasets) that have been mapped into a logical dataset.
    Returns each file with its id, filename, row_count and the column_mapping applied.
    """
    ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == logical_dataset_id)).scalars().first()
    if not ld:
        raise HTTPException(status_code=404, detail="Logical dataset not found")

    mappings = db.execute(
        select(LogicalDatasetMapping).where(LogicalDatasetMapping.logical_dataset_id == logical_dataset_id)
    ).scalars().all()

    results = []
    mapped_dataset_ids = set()

    # 1. Direct mappings via LogicalDatasetMapping
    for m in mappings:
        ds = db.execute(select(Dataset).where(Dataset.id == m.dataset_id)).scalars().first()
        if ds:
            results.append({
                "dataset_id": ds.id,
                "file_name": ds.file_name,
                "row_count": ds.row_count,
                "column_mapping": m.column_mapping,
                "mapped_at": m.created_at,
            })
            mapped_dataset_ids.add(ds.id)

    # 2. Add static datasets that match this LogicalDataset's name
    #    (Handling cases where AI preferred a Static Schema with the same name)
    datasets_by_name = db.execute(select(Dataset).where(
        Dataset.product_id == ld.product_id,
        Dataset.mapped_schema_name == ld.dataset_name,
        Dataset.schema_type == 'static'
    )).scalars().all()

    for ds in datasets_by_name:
        if ds.id not in mapped_dataset_ids:
            results.append({
                "dataset_id": ds.id,
                "file_name": ds.file_name,
                "row_count": ds.row_count,
                "column_mapping": ds.column_mapping or {},
                "mapped_at": ds.created_at,
            })

    return results


@router.get("/all-schemas")
def list_all_schemas(product_id: str, db: Session = Depends(get_db)):
    """List all schemas (static and dynamic) for a product in a unified format."""
    static_schemas = db.execute(select(TargetSchema).where(TargetSchema.product_id == product_id)).scalars().unique().all()
    dynamic_schemas = db.execute(select(LogicalDataset).where(LogicalDataset.product_id == product_id)).scalars().all()
    
    results = []
    
    for s in static_schemas:
        results.append({
            "id": s.id,
            "schema_name": s.schema_name,
            "schema_type": "static",
            "description": s.description,
            "columns": [{"key": c.key, "data_type": c.data_type, "required": c.required, "description": c.description} for c in s.columns],
        })
        
    for d in dynamic_schemas:
        # Get columns from mapping
        from ..services.similarity import get_logical_schema_columns
        cols = get_logical_schema_columns(db, d.id)
        results.append({
            "id": d.id,
            "schema_name": d.dataset_name,
            "schema_type": "dynamic",
            "description": d.description,
            "columns": [{"key": c, "data_type": "text", "required": False, "description": ""} for c in cols],
        })
        
    return results


@router.get("/datasets/{dataset_id}/mapping-history")
def get_mapping_history(dataset_id: str, db: Session = Depends(get_db)):
    """Return all past mapping versions for a dataset, newest first."""
    from ..models import MappingHistory
    current = db.execute(
        select(LogicalDatasetMapping).where(LogicalDatasetMapping.dataset_id == dataset_id)
    ).scalars().first()
    
    history = db.execute(
        select(MappingHistory).where(MappingHistory.dataset_id == dataset_id).order_by(MappingHistory.version.desc())
    ).scalars().all()
    
    records = []
    if current:
        ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == current.logical_dataset_id)).scalars().first()
        records.append({
            "version": current.version,
            "logical_dataset_id": current.logical_dataset_id,
            "logical_dataset_name": ld.dataset_name if ld else "Unknown",
            "column_mapping": current.column_mapping,
            "created_at": current.created_at,
            "updated_at": current.updated_at,
            "status": "current",
        })
    
    for h in history:
        ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == h.logical_dataset_id)).scalars().first()
        records.append({
            "version": h.version,
            "logical_dataset_id": h.logical_dataset_id,
            "logical_dataset_name": ld.dataset_name if ld else "Unknown",
            "column_mapping": h.column_mapping,
            "created_at": h.created_at,
            "superseded_at": h.superseded_at,
            "status": "archived",
        })
    
    return records


@router.get("/datasets/{dataset_id}/preview-remapped")
def preview_dataset_remapped(dataset_id: str, mode: str = "full", db: Session = Depends(get_db)):
    """
    Return a raw dataset preview with column names remapped to target schema keys.
    Modes:
      - 'full': original columns + renamed mapped columns
      - 'mapped_only': only the columns that were mapped
    """
    dataset = db.execute(select(Dataset).where(Dataset.id == dataset_id)).scalars().first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    mapping_rec = db.execute(
        select(LogicalDatasetMapping).where(LogicalDatasetMapping.dataset_id == dataset_id)
    ).scalars().first()
    
    raw = query_dataset(engine, f'SELECT * FROM "{dataset.table_name}" LIMIT 200')
    
    col_map = None
    if mapping_rec:
        col_map = mapping_rec.column_mapping
    elif dataset.column_mapping:
        col_map = dataset.column_mapping
        
    if not col_map:
        return sanitize_nans(raw)
    
    if mode == "mapped_only":
        remapped_columns = []
        for c in raw["columns"]:
            if c in col_map and col_map[c] and col_map[c] != "- skip -":
                remapped_columns.append(col_map[c])
                
        remapped_rows = []
        for row in raw["rows"]:
            remapped_row = {}
            for src_col, val in row.items():
                if src_col in col_map and col_map[src_col] and col_map[src_col] != "- skip -":
                    remapped_row[col_map[src_col]] = val
            remapped_rows.append(remapped_row)
            
        return sanitize_nans({"columns": remapped_columns, "rows": remapped_rows})

    else:
        # Full mode
        remapped_rows = []
        for row in raw["rows"]:
            remapped_row = {}
            for src_col, val in row.items():
                target = col_map.get(src_col)
                if target and target != "- skip -":
                    remapped_row[target] = val
                else:
                    remapped_row[src_col] = val
            remapped_rows.append(remapped_row)
        
        remapped_columns = []
        for c in raw["columns"]:
            target = col_map.get(c)
            if target and target != "- skip -":
                remapped_columns.append(target)
            else:
                remapped_columns.append(c)
                
        return sanitize_nans({"columns": remapped_columns, "rows": remapped_rows})


@router.delete("/logical-datasets/{logical_dataset_id}")
def delete_logical_dataset(logical_dataset_id: str, db: Session = Depends(get_db)):
    """Delete a logical dataset and its associated analytics table."""
    ld = db.execute(select(LogicalDataset).where(LogicalDataset.id == logical_dataset_id)).scalars().first()
    if not ld:
        raise HTTPException(status_code=404, detail="Logical dataset not found")

    # Drop the analytics table if it exists
    analytics_table = f"analytics_{logical_dataset_id}"
    try:
        with engine.connect() as conn:
            conn.execute(text(f'DROP TABLE IF EXISTS "{analytics_table}"'))
            conn.commit()
    except Exception as e:
        print(f"WARNING: Could not drop analytics table {analytics_table}: {e}")

    db.delete(ld)
    db.commit()
    return {"message": f"Logical dataset '{ld.dataset_name}' deleted successfully"}


@router.post("/dataset/map")
def map_dataset_to_logical(
    dataset_id: str = Form(...),
    logical_dataset_id: Optional[str] = Form(None),
    auto_map: bool = Form(False),
    column_mapping: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """
    Assign a physical dataset to a logical dataset with an explicit or AI-suggested column mapping.
    When auto_map=True and no logical_dataset_id is provided, uses the full AI schema resolver
    (Gemini AI → Qdrant → Fuzzy → Member similarity) to find the best match.
    If no match is found, auto-creates a new logical dataset from the file's own columns.
    """
    import json
    parsed_mapping = None
    if column_mapping:
        try:
            parsed_mapping = json.loads(column_mapping)
        except Exception:
            raise HTTPException(status_code=400, detail="column_mapping must be a valid JSON string")

    final_logical_dataset_id = logical_dataset_id
    ai_column_mapping = None

    if not final_logical_dataset_id and auto_map:
        dataset = db.execute(select(Dataset).where(Dataset.id == dataset_id)).scalars().first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        cols = db.execute(select(DatasetColumn).where(DatasetColumn.dataset_id == dataset_id)).scalars().all()
        col_dicts = [{"normalized_name": c.normalized_name, "data_type": c.data_type} for c in cols]
        
        # Fetch sample data from the dataset's table for AI context
        sample_data = []
        try:
            sample_result = query_dataset(engine, f'SELECT * FROM "{dataset.table_name}" LIMIT 5')
            sample_data = sample_result.get("rows", [])
        except Exception as e:
            print(f"DEBUG: Could not fetch sample data for AI context: {e}")

        # Use full AI schema resolver (same as the upload endpoint)
        try:
            from ..services.schema_resolver import resolve_best_schema, SchemaMatch
            
            match = resolve_best_schema(
                db=db,
                source_columns=col_dicts,
                sample_data=sample_data,
                product_id=dataset.product_id,
            )
            
            if match.schema_type == "dynamic" and match.logical_dataset_id:
                final_logical_dataset_id = match.logical_dataset_id
                ai_column_mapping = match.column_mapping
                print(f"DEBUG: AI Resolver matched dynamic schema '{match.schema_name}' (confidence={match.confidence:.2f})")
            elif match.schema_type == "static" and match.schema_id:
                # For static schemas, we still need a logical dataset to map to.
                # Check if one already exists for this static schema, or create one.
                from ..models import LogicalDataset as LD
                existing_ld = db.execute(select(LD).where(
                    LD.product_id == dataset.product_id,
                    LD.dataset_name == match.schema_name,
                )).scalars().first()
                if existing_ld:
                    final_logical_dataset_id = existing_ld.id
                else:
                    analytics_tbl = f"analytics_{str(uuid.uuid4()).replace('-', '_')}"
                    new_ld = LogicalDataset(
                        product_id=dataset.product_id,
                        dataset_name=match.schema_name,
                        description=f"Auto-created from static schema: {match.schema_name}",
                        table_name=analytics_tbl,
                    )
                    db.add(new_ld)
                    db.commit()
                    db.refresh(new_ld)
                    final_logical_dataset_id = new_ld.id
                ai_column_mapping = match.column_mapping
                print(f"DEBUG: AI Resolver matched static schema '{match.schema_name}' (confidence={match.confidence:.2f})")
            else:
                print(f"DEBUG: AI Resolver returned no confident match (type={match.schema_type}). Auto-creating new logical dataset.")
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"DEBUG: AI schema resolver failed: {e}")

        # Fallback: auto-create a new logical dataset from the file's own schema
        if not final_logical_dataset_id:
            import os
            base_name = os.path.splitext(dataset.file_name)[0].lower().replace(" ", "_").replace("-", "_")
            auto_name = f"{base_name}_dataset"
            
            # Check if it already exists
            existing = db.execute(select(LogicalDataset).where(
                LogicalDataset.product_id == dataset.product_id,
                LogicalDataset.dataset_name == auto_name,
            )).scalars().first()
            
            if existing:
                final_logical_dataset_id = existing.id
            else:
                analytics_tbl = f"analytics_{str(uuid.uuid4()).replace('-', '_')}"
                new_ld = LogicalDataset(
                    product_id=dataset.product_id,
                    dataset_name=auto_name,
                    description=f"Auto-created from file: {dataset.file_name}",
                    table_name=analytics_tbl,
                )
                db.add(new_ld)
                db.commit()
                db.refresh(new_ld)
                final_logical_dataset_id = new_ld.id
            
            # Identity mapping — the file defines the schema
            ai_column_mapping = {c.normalized_name: c.normalized_name for c in cols}
            print(f"DEBUG: Auto-created logical dataset '{auto_name}' for file '{dataset.file_name}'")

    if not final_logical_dataset_id:
        raise HTTPException(
            status_code=400, 
            detail="logical_dataset_id is required, or enable auto_map=True for AI-powered schema detection."
        )

    req = MapDatasetRequest(
        dataset_id=dataset_id,
        logical_dataset_id=final_logical_dataset_id,
        auto_map=auto_map,
        column_mapping=parsed_mapping or ai_column_mapping,
    )

    try:
        result = perform_mapping(req, db)
        return sanitize_nans({
            "status": "mapped and materialized",
            "dataset_id": req.dataset_id,
            **result
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
