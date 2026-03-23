import os
import uuid
import zipfile
import io
import pandas as pd
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session
from ..database import engine
from ..models import (
    Dataset,
    DatasetColumn,
    DatasetVersion,
    LogicalDataset,
    LogicalDatasetMapping,
    UploadJob,
)
from .data_processor import load_dataframe
from .schema_inference import infer_schema, pg_type
from .similarity import suggest_logical_dataset
from ..utils.json_utils import sanitize_nans

def prepare_ingestion_items(temp_dir: str) -> list[dict]:
    """
    Expand files from temp folder (including sub-zips).
    Returns a list of {"filename": str, "content": bytes}
    """
    processed_files_list = []
    files_to_read = os.listdir(temp_dir) if os.path.exists(temp_dir) else []
    
    for filename in files_to_read:
        file_path = os.path.join(temp_dir, filename)
        if not os.path.isfile(file_path):
            continue
            
        with open(file_path, "rb") as f:
            file_content = f.read()

        if filename.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(file_content)) as z:
                    for info in z.infolist():
                        if info.is_dir() or info.filename.startswith("__MACOSX") or info.filename.split("/")[-1].startswith("."):
                            continue
                        if not (info.filename.lower().endswith('.csv') or info.filename.lower().endswith('.xls') or info.filename.lower().endswith('.xlsx')):
                            continue
                        
                        extracted_content = z.read(info.filename)
                        if extracted_content:
                            base_filename = info.filename.split("/")[-1]
                            processed_files_list.append({
                                "filename": base_filename,
                                "content": extracted_content
                            })
            except Exception as e:
                print(f"Error extracting zip {filename}: {e}")
        else:
            processed_files_list.append({
                "filename": filename,
                "content": file_content
            })
    return processed_files_list

def increment_job_progress(db: Session, job_id: str):
    """Atomically increment the processed_files counter."""
    db.execute(
        text("UPDATE upload_jobs SET processed_files = processed_files + 1, updated_at = NOW() WHERE id = :job_id"),
        {"job_id": job_id}
    )
    db.commit()

def process_single_ingestion_item(
    db: Session,
    filename: str,
    file_content: bytes,
    product_id: str,
    auto_map: bool,
    logical_dataset_name: str = None
) -> dict:
    """
    Ingests a single file into the system.
    This is the core logic that can be run in parallel.
    """
    from .schema_resolver import resolve_best_schema, SchemaMatch
    from .materialization import ensure_static_table, ensure_dynamic_table, append_rows
    from .schema_inference import infer_schema, pg_type
    from .dataset_store import create_dataset_table, insert_dataset_rows, drop_dataset_table

    try:
        # Step 1 — Parse file
        df = load_dataframe(file_content, filename)
        if df.empty or len(df.columns) == 0:
            raise Exception("File contains no usable data")

        # Step 2 — Infer schema
        schema_meta = infer_schema(df, product_id, filename)
        dataset_meta = schema_meta["dataset"]
        columns_meta = schema_meta["columns"]

        # Step 3 — Create table
        create_dataset_table(engine, dataset_meta["table_name"], columns_meta)

        # Step 4 — Insert rows
        try:
            rows_inserted = insert_dataset_rows(engine, dataset_meta["table_name"], df, columns_meta)
        except Exception as e:
            drop_dataset_table(engine, dataset_meta["table_name"])
            raise e

        # Step 5 — Registry
        db_dataset = Dataset(
            id=dataset_meta["id"],
            product_id=product_id,
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

        db.add(DatasetVersion(
            dataset_id=dataset_meta["id"],
            version=1,
            table_name=dataset_meta["table_name"],
        ))
        db.commit()

        # Step 6 — Mapping Suggestions
        col_dicts = [{"normalized_name": c["normalized_name"], "data_type": c["data_type"]} for c in columns_meta]
        sample_data = df.head(5).where(pd.notna(df.head(5)), None).to_dict(orient="records")
        try:
            suggestions = suggest_logical_dataset(db, col_dicts, product_id, sample_data=sample_data)
        except:
            suggestions = []

        # Step 7 — AI Automap
        auto_mapped = False
        schema_type = None
        mapped_schema_name = None
        mapped_schema_id = None
        match_confidence = 0.0
        column_mapping_used = {}

        if auto_map or logical_dataset_name:
            try:
                forced_ld = None
                if logical_dataset_name:
                    forced_ld = db.execute(select(LogicalDataset).where(
                        LogicalDataset.product_id == product_id,
                        LogicalDataset.dataset_name == logical_dataset_name
                    )).scalars().first()
                    if not forced_ld:
                        analytics_tbl = f"analytics_{str(uuid.uuid4()).replace('-', '_')}"
                        forced_ld = LogicalDataset(
                            product_id=product_id,
                            dataset_name=logical_dataset_name,
                            table_name=analytics_tbl
                        )
                        db.add(forced_ld)
                        db.commit()
                        db.refresh(forced_ld)

                if forced_ld:
                    from .similarity import get_logical_schema_columns, generate_suggested_mapping
                    ld_cols = get_logical_schema_columns(db, forced_ld.id)
                    col_mapping = generate_suggested_mapping(
                        [c["normalized_name"] for c in col_dicts],
                        ld_cols if ld_cols else [c["normalized_name"] for c in col_dicts],
                        sample_data=sample_data
                    )
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
                    match = resolve_best_schema(db=db, source_columns=col_dicts, sample_data=sample_data, product_id=product_id)

                if match.schema_type != "none" and match.column_mapping:
                    source_cols_for_mat = [{"normalized_name": c["normalized_name"], "pg_type": pg_type(c["data_type"])} for c in columns_meta]
                    if match.schema_type == "static":
                        ensure_static_table(engine, match.analytics_table, match.column_mapping, source_cols_for_mat)
                    else:
                        ensure_dynamic_table(engine, match.analytics_table, match.column_mapping, source_cols_for_mat)

                    append_rows(engine, match.analytics_table, dataset_meta["table_name"], match.column_mapping, dataset_meta["id"])

                    if match.schema_type == "dynamic":
                        db.add(LogicalDatasetMapping(
                            logical_dataset_id=match.logical_dataset_id,
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

                    db_dataset.schema_type = schema_type
                    db_dataset.mapped_schema_name = mapped_schema_name
                    db.add(db_dataset)
                    db.commit()

            except Exception as e:
                print(f"DEBUG: Background auto-mapping failed for {filename}: {e}")

        res_data = {
            "dataset_id": dataset_meta["id"],
            "table_name": dataset_meta["table_name"],
            "rows": rows_inserted,
            "columns": [{"name": c["normalized_name"], "type": c["data_type"]} for c in columns_meta],
            "status": "success",
            "file_name": filename,
            "auto_mapped": auto_mapped,
            "schema_type": schema_type,
            "mapped_to": mapped_schema_name,
            "mapped_schema_id": mapped_schema_id,
            "match_confidence": match_confidence,
            "column_mapping": column_mapping_used,
            "logical_dataset_suggestions": suggestions,
        }
        return sanitize_nans(res_data)

    except Exception as e:
        import traceback
        print(f"Ingestion error for {filename}: {e}\n{traceback.format_exc()}")
        return {"file_name": filename, "status": "error", "error": str(e)}

def run_bulk_ingestion_workflow(
    db: Session,
    job: UploadJob,
    temp_dir: str,
    product_id: str,
    auto_map: bool,
    logical_dataset_name: str = None
):
    """
    Legacy sequential version (for backward compatibility or synchronous calls).
    """
    items = prepare_ingestion_items(temp_dir)
    job.total_files = len(items)
    db.commit()

    results = []
    for item in items:
        res = process_single_ingestion_item(
            db=db,
            filename=item["filename"],
            file_content=item["content"],
            product_id=product_id,
            auto_map=auto_map,
            logical_dataset_name=logical_dataset_name
        )
        results.append(res)
        increment_job_progress(db, job.id)
    
    return results
