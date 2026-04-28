import os
from celery import Celery, chord, chain as celery_chain
from sqlalchemy.orm import Session
from .database import SessionLocal, engine
from .models import (
    UploadJob, LogicalDataset, DatasetProfile, DataAnomaly, TrendAnalysis, DatasetInsight,
    Dataset, DatasetFileProfile, DatasetFileAnomaly, DatasetFileInsight,
)
from .utils.json_utils import sanitize_nans

# Configure Celery with Redis as broker and result backend
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

app = Celery(
    "maplayer",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["src.celery_app"]
)

app.conf.update(
    task_track_started=True,
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

def _expand_excel_sheets(filename: str, content: bytes) -> list:
    """
    For Excel files with multiple sheets, returns one task item per sheet.
    For CSV files (or single-sheet Excel), returns a single item with no sheet_name.
    """
    import base64
    if not (filename.lower().endswith('.xlsx') or filename.lower().endswith('.xls') or filename.lower().endswith('.xlsm')):
        return [{"filename": filename, "content_b64": base64.b64encode(content).decode("utf-8")}]

    try:
        from .services.data_processor import get_excel_sheet_names
        sheet_names = get_excel_sheet_names(content)
    except Exception as e:
        print(f"Could not read sheet names from {filename}: {e}")
        return [{"filename": filename, "content_b64": base64.b64encode(content).decode("utf-8")}]

    if len(sheet_names) <= 1:
        return [{"filename": filename, "content_b64": base64.b64encode(content).decode("utf-8")}]

    content_b64 = base64.b64encode(content).decode("utf-8")
    items = []
    for sheet in sheet_names:
        items.append({
            "filename": filename,
            "content_b64": content_b64,
            "sheet_name": sheet,
        })
    print(f"DEBUG: Expanded '{filename}' into {len(items)} sheet(s): {sheet_names}")
    return items


@app.task(bind=True)
def process_ingestion_job(self, job_id: str, product_id: str, auto_map: bool, logical_dataset_name: str = None, files_data: list = None):
    """
    Dispatcher task:
    1. Expands all files (including ZIPs) from the base64-encoded message data.
    2. Spawns parallel sub-tasks for each file.
    """
    import base64
    import zipfile
    import io

    db: Session = SessionLocal()
    job = db.query(UploadJob).filter(UploadJob.id == job_id).first()
    if not job:
        db.close()
        return {"error": "Job not found"}

    try:
        job.status = "PROCESSING"
        db.commit()

        SUPPORTED_EXTENSIONS = ('.csv', '.xls', '.xlsx', '.xlsm', '.xlsb')

        def _extract_zip_items(zip_bytes: bytes, source_name: str, depth: int = 0) -> list:
            """Recursively extract spreadsheet/PDF task items from a ZIP, handling nested ZIPs."""
            if depth > 3:
                return []
            result = []
            try:
                with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
                    for info in z.infolist():
                        entry_name = info.filename
                        base_name = entry_name.split("/")[-1]
                        # Skip macOS metadata, hidden files, and directories
                        if info.is_dir() or "__MACOSX" in entry_name or base_name.startswith("."):
                            continue
                        entry_content = z.read(entry_name)
                        if not entry_content:
                            continue
                        name_lower = base_name.lower()
                        if name_lower.endswith(".zip"):
                            # Recurse into nested ZIP
                            result.extend(_extract_zip_items(entry_content, base_name, depth + 1))
                        elif name_lower.endswith(".pdf"):
                            result.append({
                                "filename": base_name,
                                "content_b64": base64.b64encode(entry_content).decode("utf-8"),
                                "is_pdf": True,
                            })
                        elif any(name_lower.endswith(ext) for ext in SUPPORTED_EXTENSIONS):
                            result.extend(_expand_excel_sheets(base_name, entry_content))
            except Exception as e:
                print(f"Error extracting zip '{source_name}': {e}")
                # Surface the error as a failed result so it's visible in the UI
                result.append({"_zip_error": True, "filename": source_name, "error": str(e)})
            return result

        # Expand files from message data (including recursive ZIP extraction)
        items = []
        extraction_errors = []
        for file_data in (files_data or []):
            filename = file_data["filename"]
            content = base64.b64decode(file_data["content_b64"])

            if filename.lower().endswith(".zip"):
                extracted = _extract_zip_items(content, filename)
                zip_errors = [e for e in extracted if e.get("_zip_error")]
                extraction_errors.extend(zip_errors)
                items.extend([e for e in extracted if not e.get("_zip_error")])
            elif filename.lower().endswith(".pdf"):
                items.append({
                    "filename": filename,
                    "content_b64": file_data["content_b64"],
                    "is_pdf": True,
                })
            else:
                items.extend(_expand_excel_sheets(filename, content))

        if not items:
            error_details = "; ".join(e["error"] for e in extraction_errors) if extraction_errors else "No supported files found inside the archive (expected .csv, .xls, .xlsx, .xlsm, .xlsb, .pdf)"
            job.status = "FAILED"
            job.error_message = error_details
            job.results = [{"file_name": e["filename"], "status": "error", "error": e["error"]} for e in extraction_errors] or []
            db.commit()
            return {"status": "error", "message": error_details}

        # Update total count
        job.total_files = len(items)
        db.commit()

        # Dispatch parallel tasks — content travels in the message, no shared filesystem needed
        pdf_items = [item for item in items if item.get("is_pdf")]
        data_items = [item for item in items if not item.get("is_pdf")]
        header = [
            process_single_file_task.s(job_id, product_id, auto_map, logical_dataset_name, item)
            for item in data_items
        ] + [
            process_single_pdf_task.s(job_id, product_id, logical_dataset_name, item)
            for item in pdf_items
        ]
        callback = finalize_ingestion_job.s(job_id)

        chord(header)(callback)
        return {"status": "dispatched", "task_count": len(items)}

    except Exception as e:
        import traceback
        error_info = traceback.format_exc()
        print(f"CELERY DISPATCHER ERROR: {e}\n{error_info}")
        job.status = "FAILED"
        job.error_message = str(e)
        db.commit()
        return {"status": "error", "message": str(e)}
    finally:
        db.close()

@app.task
def process_single_file_task(job_id: str, product_id: str, auto_map: bool, logical_dataset_name: str, task_item: dict):
    """Worker task: processes one file (or one sheet of a multi-sheet Excel)."""
    import base64
    db: Session = SessionLocal()
    from .services.ingestion_service import process_single_ingestion_item, increment_job_progress

    try:
        filename = task_item["filename"]
        content = base64.b64decode(task_item["content_b64"])
        sheet_name = task_item.get("sheet_name")

        result = process_single_ingestion_item(
            db=db,
            filename=filename,
            sheet_name=sheet_name,
            file_content=content,
            product_id=product_id,
            auto_map=auto_map,
            logical_dataset_name=logical_dataset_name
        )
        
        increment_job_progress(db, job_id)
        return result
    except Exception as e:
        return {"file_name": task_item.get("filename", "unknown"), "status": "error", "error": str(e)}
    finally:
        db.close()

@app.task
def process_single_pdf_task(job_id: str, product_id: str, logical_dataset_name: str, task_item: dict):
    """Worker task: processes all pages of a PDF and creates a Dataset for each page with extractable table data."""
    import base64, uuid
    import pandas as pd
    from sqlalchemy import select
    db: Session = SessionLocal()
    from .services.ingestion_service import increment_job_progress
    from .services.pdf_extractor import get_page_count, render_page_to_base64
    from .services.gemini import analyze_pdf_table, extract_pdf_table_with_ai
    from .services.dataset_store import create_dataset_table, insert_dataset_rows
    from .services.schema_inference import pg_type
    from .models import Dataset, DatasetColumn, DatasetVersion, TargetSchema

    _DTYPE_ALIAS = {
        "text": "string", "string": "string", "number": "float", "date": "timestamp",
        "datetime": "timestamp", "timestamp": "timestamp", "integer": "integer",
        "float": "float", "boolean": "boolean", "json": "json",
    }

    filename = task_item.get("filename", "unknown.pdf")
    try:
        content = base64.b64decode(task_item["content_b64"])

        try:
            page_count = get_page_count(content)
        except Exception as e:
            increment_job_progress(db, job_id)
            return [{"file_name": filename, "status": "error", "error": f"Could not read PDF: {e}"}]

        all_schemas = db.execute(
            select(TargetSchema).where(TargetSchema.product_id == product_id)
        ).scalars().all()
        schemas_by_id = {str(s.id): s for s in all_schemas}
        existing_schemas = [
            {
                "id": str(s.id),
                "name": s.schema_name,
                "columns": [{"key": col.key, "label": col.label, "data_type": col.data_type} for col in s.columns],
            }
            for s in all_schemas
        ]

        page_results = []
        for page_num in range(1, page_count + 1):
            display_name = f"PDF: {filename} (p{page_num})"
            try:
                page_image_b64 = render_page_to_base64(content, page_num, dpi=150)
                analysis = analyze_pdf_table(page_image_b64, existing_schemas)
                detected_columns = analysis.get("detected_columns") or []
                best_match = analysis.get("best_match")

                if not detected_columns:
                    continue  # No table on this page

                # Build schema_columns for extraction
                if best_match:
                    matched_schema = schemas_by_id.get(str(best_match["schema_id"]))
                    if matched_schema and matched_schema.columns:
                        schema_columns = [
                            {
                                "key": col.key, "label": col.label, "data_type": col.data_type,
                                "description": col.description or "", "required": col.required,
                                "format_hint": col.format_hint or "", "examples": col.examples or [],
                            }
                            for col in matched_schema.columns
                        ]
                        mapped_schema_name = matched_schema.schema_name
                        schema_type_value = "static"
                    else:
                        best_match = None

                if not best_match:
                    schema_columns = [
                        {
                            "key": col["suggested_key"], "label": col["detected_header"],
                            "data_type": col.get("data_type", "string"), "description": "",
                            "required": False, "format_hint": "", "examples": [],
                        }
                        for col in detected_columns
                    ]
                    mapped_schema_name = f"Auto ({len(schema_columns)} columns)"
                    schema_type_value = "dynamic"

                rows = extract_pdf_table_with_ai(page_image_b64, schema_columns, None)
                if not rows:
                    continue

                columns_meta = [
                    {
                        "column_name": col["key"],
                        "normalized_name": col["key"],
                        "data_type": _DTYPE_ALIAS.get(col["data_type"].lower(), "string"),
                        "pg_type": pg_type(_DTYPE_ALIAS.get(col["data_type"].lower(), "string")),
                    }
                    for col in schema_columns
                ]
                column_mapping = {col["key"]: col["key"] for col in schema_columns}

                df = pd.DataFrame(rows)
                for col in columns_meta:
                    if col["normalized_name"] not in df.columns:
                        df[col["normalized_name"]] = None

                dataset_id = str(uuid.uuid4())
                table_name = f"upload_{dataset_id.replace('-', '_')}"

                create_dataset_table(engine, table_name, columns_meta)
                row_count = insert_dataset_rows(engine, table_name, df, columns_meta)

                dataset = Dataset(
                    id=dataset_id,
                    product_id=product_id,
                    file_name=display_name,
                    table_name=table_name,
                    row_count=row_count,
                    schema_type=schema_type_value,
                    mapped_schema_name=mapped_schema_name,
                    column_mapping=column_mapping,
                )
                db.add(dataset)
                for col in columns_meta:
                    db.add(DatasetColumn(
                        dataset_id=dataset_id,
                        column_name=col["column_name"],
                        normalized_name=col["normalized_name"],
                        data_type=col["data_type"],
                    ))
                db.add(DatasetVersion(dataset_id=dataset_id, version=1, table_name=table_name))
                db.commit()

                page_results.append({
                    "file_name": display_name,
                    "status": "success",
                    "dataset_id": dataset_id,
                    "row_count": row_count,
                    "schema_name": mapped_schema_name,
                    "schema_type": schema_type_value,
                })
            except Exception as e:
                page_results.append({"file_name": display_name, "status": "error", "error": str(e)})

        increment_job_progress(db, job_id)

        if not page_results:
            return [{"file_name": filename, "status": "error", "error": "No table data found in any page of this PDF"}]
        return page_results

    except Exception as e:
        return [{"file_name": filename, "status": "error", "error": str(e)}]
    finally:
        db.close()


@app.task
def finalize_ingestion_job(results, job_id: str):
    """Aggregator task: collects results and finishes the job."""
    db: Session = SessionLocal()
    try:
        job = db.query(UploadJob).filter(UploadJob.id == job_id).first()
        if not job:
            return {"error": "Job not found"}

        # Flatten nested lists returned by process_single_pdf_task (one list per PDF)
        flat_results = []
        for r in results:
            if isinstance(r, list):
                flat_results.extend(r)
            else:
                flat_results.append(r)
        results = flat_results

        job.status = "COMPLETED"
        job.results = sanitize_nans(results)
        db.commit()

        # Dispatch analytics pipeline for any logical datasets mapped during this job
        logical_ids_seen = set()
        for r in results:
            if isinstance(r, dict) and r.get("schema_type") == "dynamic" and r.get("mapped_schema_id"):
                logical_ids_seen.add(r["mapped_schema_id"])

        for ld_id in logical_ids_seen:
            celery_chain(
                profile_logical_dataset.s(ld_id),
                detect_anomalies.s(ld_id),
                detect_trends.s(ld_id),
                generate_narrative_insight.s(ld_id),
            ).delay()

        # Dispatch per-file analytics chain for each successfully processed file
        for r in results:
            if isinstance(r, dict) and r.get("dataset_id") and r.get("status") == "success":
                celery_chain(
                    profile_single_dataset.s(r["dataset_id"]),
                    detect_single_dataset_anomalies.s(r["dataset_id"]),
                    generate_single_dataset_narrative.s(r["dataset_id"]),
                ).delay()

        return {"status": "success", "results_count": len(results)}
    except Exception as e:
        print(f"CELERY FINALIZER ERROR: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        db.close()


# ─────────────────────────────────────────────
# Post-Processing Analytics Pipeline Tasks
# ─────────────────────────────────────────────

@app.task(bind=True)
def profile_logical_dataset(self, logical_dataset_id: str) -> dict:
    """
    Stage 1: Compute per-column statistical profiles for a LogicalDataset.
    Reads the materialized analytics table and calculates min/max/mean/median/std/nulls/top-values.
    """
    import pandas as pd
    import numpy as np
    from sqlalchemy import text as sa_text

    db: Session = SessionLocal()
    try:
        ld = db.query(LogicalDataset).filter(LogicalDataset.id == logical_dataset_id).first()
        if not ld:
            return {"error": f"LogicalDataset {logical_dataset_id} not found"}

        # Load the full materialized table
        with engine.connect() as conn:
            result = conn.execute(sa_text(f'SELECT * FROM "{ld.table_name}"'))
            columns = list(result.keys())
            rows = result.fetchall()

        if not rows:
            # Write null profiles for empty tables
            db.query(DatasetProfile).filter(DatasetProfile.logical_dataset_id == logical_dataset_id).delete()
            for col in columns:
                db.add(DatasetProfile(
                    logical_dataset_id=logical_dataset_id,
                    column_name=col,
                    row_count=0,
                ))
            db.commit()
            return {"logical_dataset_id": logical_dataset_id, "columns_profiled": len(columns)}

        df = pd.DataFrame([dict(zip(columns, row)) for row in rows])

        # Determine data types from DatasetProfile source columns via mappings
        # Build a simple lookup: column_name -> data_type from the dataframe dtypes
        def infer_dtype(series: pd.Series) -> str:
            if pd.api.types.is_float_dtype(series):
                return "float"
            if pd.api.types.is_integer_dtype(series):
                return "integer"
            if pd.api.types.is_bool_dtype(series):
                return "boolean"
            if pd.api.types.is_datetime64_any_dtype(series):
                return "timestamp"
            # Try parsing as datetime
            try:
                parsed = pd.to_datetime(series.dropna().astype(str).head(20), errors="raise")
                if len(parsed) > 0:
                    return "timestamp"
            except Exception:
                pass
            return "string"

        # Delete existing profiles for idempotency
        db.query(DatasetProfile).filter(DatasetProfile.logical_dataset_id == logical_dataset_id).delete()
        db.commit()

        row_count = len(df)
        profiles = []

        for col in df.columns:
            series = df[col]
            null_count = int(series.isna().sum())
            null_pct = round(null_count / row_count, 4) if row_count > 0 else 0.0
            distinct_count = int(series.nunique(dropna=True))
            data_type = infer_dtype(series)

            min_val = max_val = mean_val = median_val = std_val = None

            numeric_series = series.dropna()
            if data_type in ("float", "integer") and numeric_series.notna().sum() > 1:
                try:
                    numeric = pd.to_numeric(numeric_series, errors="coerce").dropna()
                    if len(numeric) > 1:
                        min_val = str(numeric.min())
                        max_val = str(numeric.max())
                        mean_val = float(numeric.mean())
                        median_val = float(numeric.median())
                        std_val = float(numeric.std())
                except Exception:
                    pass
            else:
                try:
                    str_series = series.dropna().astype(str)
                    if len(str_series) > 0:
                        min_val = str(str_series.min())
                        max_val = str(str_series.max())
                except Exception:
                    pass

            # Top-5 value frequencies
            try:
                vc = series.astype(str).value_counts().head(5)
                top_values = [{"value": str(v), "count": int(c)} for v, c in vc.items()]
            except Exception:
                top_values = []

            profiles.append(DatasetProfile(
                logical_dataset_id=logical_dataset_id,
                column_name=col,
                data_type=data_type,
                row_count=row_count,
                null_count=null_count,
                null_pct=null_pct,
                distinct_count=distinct_count,
                min_value=min_val,
                max_value=max_val,
                mean_value=mean_val,
                median_value=median_val,
                std_dev=std_val,
                top_values=top_values,
            ))

        db.bulk_save_objects(profiles)
        db.commit()
        return {"logical_dataset_id": logical_dataset_id, "columns_profiled": len(profiles)}

    except Exception as e:
        import traceback
        print(f"PROFILE TASK ERROR [{logical_dataset_id}]: {e}\n{traceback.format_exc()}")
        return {"logical_dataset_id": logical_dataset_id, "error": str(e)}
    finally:
        db.close()


@app.task(bind=True)
def detect_anomalies(self, profile_result: dict, logical_dataset_id: str) -> dict:
    """
    Stage 2: Detect outliers and anomalies in a LogicalDataset.
    Uses Z-Score and IQR for numeric columns; rare-value detection for categoricals.
    """
    import pandas as pd
    import numpy as np
    from sqlalchemy import text as sa_text

    db: Session = SessionLocal()
    try:
        ld = db.query(LogicalDataset).filter(LogicalDataset.id == logical_dataset_id).first()
        if not ld:
            return {"error": f"LogicalDataset {logical_dataset_id} not found"}

        # Load profiles to know column types
        profiles = db.query(DatasetProfile).filter(DatasetProfile.logical_dataset_id == logical_dataset_id).all()
        if not profiles:
            return {"logical_dataset_id": logical_dataset_id, "anomalies_found": 0, "skipped_reason": "no_profile"}

        type_map = {p.column_name: p.data_type for p in profiles}
        row_count = profiles[0].row_count or 0
        if row_count == 0:
            return {"logical_dataset_id": logical_dataset_id, "anomalies_found": 0}

        # Use sampling for large tables to keep performance reasonable
        if row_count > 50000:
            sql = f'SELECT * FROM "{ld.table_name}" TABLESAMPLE BERNOULLI(10)'
        else:
            sql = f'SELECT * FROM "{ld.table_name}"'

        with engine.connect() as conn:
            result = conn.execute(sa_text(sql))
            columns = list(result.keys())
            rows = result.fetchall()

        if not rows:
            return {"logical_dataset_id": logical_dataset_id, "anomalies_found": 0}

        df = pd.DataFrame([dict(zip(columns, row)) for row in rows])

        # Delete existing anomalies for idempotency
        db.query(DataAnomaly).filter(DataAnomaly.logical_dataset_id == logical_dataset_id).delete()
        db.commit()

        anomalies = []
        ANOMALY_CAP = 2000

        from scipy.stats import zscore as scipy_zscore

        for col in df.columns:
            if len(anomalies) >= ANOMALY_CAP:
                break
            col_type = type_map.get(col, "string")

            if col_type in ("float", "integer"):
                numeric = pd.to_numeric(df[col], errors="coerce")
                valid_mask = numeric.notna()
                valid_series = numeric[valid_mask]

                if valid_series.notna().sum() <= 1:
                    continue

                # Z-Score flags
                try:
                    z_scores = scipy_zscore(valid_series.astype(float))
                    zscore_flags = set()
                    for idx, (orig_idx, z) in enumerate(zip(valid_series.index, z_scores)):
                        if abs(z) > 3:
                            severity = "high" if abs(z) > 4 else "medium"
                            zscore_flags.add(orig_idx)
                            if len(anomalies) < ANOMALY_CAP:
                                anomalies.append(DataAnomaly(
                                    logical_dataset_id=logical_dataset_id,
                                    column_name=col,
                                    row_index=int(orig_idx),
                                    value=str(df.at[orig_idx, col]),
                                    method="zscore",
                                    reason=f"Z-score of {z:.2f} exceeds threshold of 3.0",
                                    severity=severity,
                                ))
                except Exception:
                    zscore_flags = set()

                # IQR flags
                try:
                    q1 = float(valid_series.quantile(0.25))
                    q3 = float(valid_series.quantile(0.75))
                    iqr = q3 - q1
                    lower = q1 - 1.5 * iqr
                    upper = q3 + 1.5 * iqr

                    for orig_idx, val in valid_series.items():
                        if val < lower or val > upper:
                            # Upgrade existing zscore anomaly to high severity if also IQR
                            if orig_idx in zscore_flags:
                                for a in anomalies:
                                    if a.row_index == int(orig_idx) and a.column_name == col and a.method == "zscore":
                                        a.severity = "high"
                                        break
                            elif len(anomalies) < ANOMALY_CAP:
                                direction = "below" if val < lower else "above"
                                anomalies.append(DataAnomaly(
                                    logical_dataset_id=logical_dataset_id,
                                    column_name=col,
                                    row_index=int(orig_idx),
                                    value=str(val),
                                    method="iqr",
                                    reason=f"Value {val:.2f} is {direction} IQR boundary [{lower:.2f}, {upper:.2f}]",
                                    severity="medium",
                                ))
                except Exception:
                    pass

            elif col_type == "string":
                # Rare categorical value detection
                try:
                    vc = df[col].value_counts(dropna=True)
                    total = len(df)
                    for val, count in vc.items():
                        if count < 3 and (count / total) < 0.005:
                            idxs = df.index[df[col] == val].tolist()
                            for orig_idx in idxs[:5]:  # cap per-value rows
                                if len(anomalies) < ANOMALY_CAP:
                                    anomalies.append(DataAnomaly(
                                        logical_dataset_id=logical_dataset_id,
                                        column_name=col,
                                        row_index=int(orig_idx),
                                        value=str(val),
                                        method="rare_categorical",
                                        reason=f"Value '{val}' appears only {count} time(s) ({count/total*100:.2f}% of rows)",
                                        severity="low",
                                    ))
                except Exception:
                    pass

        db.bulk_save_objects(anomalies)
        db.commit()
        return {"logical_dataset_id": logical_dataset_id, "anomalies_found": len(anomalies)}

    except Exception as e:
        import traceback
        print(f"ANOMALY TASK ERROR [{logical_dataset_id}]: {e}\n{traceback.format_exc()}")
        return {"logical_dataset_id": logical_dataset_id, "error": str(e)}
    finally:
        db.close()


@app.task(bind=True)
def detect_trends(self, anomaly_result: dict, logical_dataset_id: str) -> dict:
    """
    Stage 3: Detect time-series trends for numeric columns in a LogicalDataset.
    Only activates if a timestamp column is found in the profile.
    """
    import pandas as pd
    import numpy as np
    from sqlalchemy import text as sa_text

    db: Session = SessionLocal()
    try:
        ld = db.query(LogicalDataset).filter(LogicalDataset.id == logical_dataset_id).first()
        if not ld:
            return {"error": f"LogicalDataset {logical_dataset_id} not found"}

        profiles = db.query(DatasetProfile).filter(DatasetProfile.logical_dataset_id == logical_dataset_id).all()
        if not profiles:
            return {"logical_dataset_id": logical_dataset_id, "trends_found": 0, "skipped_reason": "no_profile"}

        type_map = {p.column_name: p.data_type for p in profiles}

        # Find timestamp columns
        time_cols = [col for col, dtype in type_map.items() if dtype == "timestamp"]
        if not time_cols:
            return {"logical_dataset_id": logical_dataset_id, "trends_found": 0, "skipped_reason": "no_timestamp_column"}

        time_col = time_cols[0]  # use first detected timestamp column
        numeric_cols = [col for col, dtype in type_map.items() if dtype in ("float", "integer")]

        # Load the data
        with engine.connect() as conn:
            result = conn.execute(sa_text(f'SELECT * FROM "{ld.table_name}"'))
            columns = list(result.keys())
            rows = result.fetchall()

        if not rows:
            return {"logical_dataset_id": logical_dataset_id, "trends_found": 0}

        df = pd.DataFrame([dict(zip(columns, row)) for row in rows])

        # Parse the timestamp column
        try:
            df[time_col] = pd.to_datetime(df[time_col], errors="coerce")
        except Exception:
            return {"logical_dataset_id": logical_dataset_id, "trends_found": 0, "skipped_reason": "timestamp_parse_failed"}

        df = df.dropna(subset=[time_col])
        if len(df) == 0:
            return {"logical_dataset_id": logical_dataset_id, "trends_found": 0}

        # Delete existing trends for idempotency
        db.query(TrendAnalysis).filter(TrendAnalysis.logical_dataset_id == logical_dataset_id).delete()
        db.commit()

        trends = []
        for val_col in numeric_cols:
            if val_col == time_col:
                continue
            try:
                numeric = pd.to_numeric(df[val_col], errors="coerce")
                tmp = df[[time_col]].copy()
                tmp["_val"] = numeric
                tmp = tmp.dropna()
                if len(tmp) == 0:
                    continue

                # Group by month
                grouped = tmp.groupby(tmp[time_col].dt.to_period("M"))["_val"].mean()
                if len(grouped) < 3:
                    continue  # need at least 3 periods for meaningful trend

                values = grouped.values.astype(float)
                periods = [str(p) for p in grouped.index]
                x = np.arange(len(values), dtype=float)

                # Linear regression slope
                coeffs = np.polyfit(x, values, 1)
                slope = float(coeffs[0])

                # R-squared
                y_pred = np.polyval(coeffs, x)
                ss_res = np.sum((values - y_pred) ** 2)
                ss_tot = np.sum((values - values.mean()) ** 2)
                r_squared = float(1 - ss_res / ss_tot) if ss_tot != 0 else 0.0

                # Direction: slope threshold relative to mean value magnitude
                mean_val = values.mean()
                threshold = abs(mean_val) * 0.01 if mean_val != 0 else 0.001
                if slope > threshold:
                    direction = "up"
                elif slope < -threshold:
                    direction = "down"
                else:
                    direction = "flat"

                series_data = [{"period": p, "value": float(v)} for p, v in zip(periods, values)]

                trends.append(TrendAnalysis(
                    logical_dataset_id=logical_dataset_id,
                    time_column=time_col,
                    value_column=val_col,
                    period="month",
                    direction=direction,
                    slope=slope,
                    r_squared=r_squared,
                    series_data=series_data,
                ))
            except Exception:
                continue

        db.bulk_save_objects(trends)
        db.commit()
        return {"logical_dataset_id": logical_dataset_id, "trends_found": len(trends), "time_column": time_col}

    except Exception as e:
        import traceback
        print(f"TRENDS TASK ERROR [{logical_dataset_id}]: {e}\n{traceback.format_exc()}")
        return {"logical_dataset_id": logical_dataset_id, "error": str(e)}
    finally:
        db.close()


@app.task(bind=True)
def generate_narrative_insight(self, trend_result: dict, logical_dataset_id: str) -> dict:
    """
    Stage 4: Generate an LLM-powered executive narrative for a LogicalDataset.
    Reads pre-computed profiles, anomalies, and trends — sends only stats to Gemini.
    """
    db: Session = SessionLocal()
    try:
        ld = db.query(LogicalDataset).filter(LogicalDataset.id == logical_dataset_id).first()
        if not ld:
            return {"error": f"LogicalDataset {logical_dataset_id} not found"}

        # Load all pre-computed data
        profiles = db.query(DatasetProfile).filter(DatasetProfile.logical_dataset_id == logical_dataset_id).all()
        anomalies = db.query(DataAnomaly).filter(DataAnomaly.logical_dataset_id == logical_dataset_id).all()
        trends = db.query(TrendAnalysis).filter(TrendAnalysis.logical_dataset_id == logical_dataset_id).all()

        # Build compact profile summary (no raw data)
        column_profiles = []
        for p in profiles:
            col_summary = {
                "column": p.column_name,
                "type": p.data_type,
                "null_pct": round(p.null_pct or 0, 3),
                "distinct_count": p.distinct_count,
            }
            if p.mean_value is not None:
                col_summary["mean"] = round(p.mean_value, 3)
                col_summary["std"] = round(p.std_dev or 0, 3)
            if p.top_values:
                col_summary["top_values"] = p.top_values[:3]
            column_profiles.append(col_summary)

        # Anomaly summary
        high = sum(1 for a in anomalies if a.severity == "high")
        medium = sum(1 for a in anomalies if a.severity == "medium")
        low = sum(1 for a in anomalies if a.severity == "low")
        top_anomaly_cols = list(dict.fromkeys(a.column_name for a in anomalies))[:5]
        anomaly_summary = {
            "total": len(anomalies),
            "high": high,
            "medium": medium,
            "low": low,
            "top_columns": top_anomaly_cols,
        }

        # Trend summary
        trend_summary = [
            {"column": t.value_column, "direction": t.direction, "slope": round(t.slope or 0, 4)}
            for t in trends
        ]

        # Build profile_snapshot for auditability
        profile_snapshot = {
            "column_profiles": column_profiles,
            "anomaly_summary": anomaly_summary,
            "trend_summary": trend_summary,
        }

        # Call Gemini
        try:
            from .services.gemini import generate_narrative_with_ai
            result = generate_narrative_with_ai(
                dataset_name=ld.dataset_name,
                column_profiles=column_profiles,
                anomaly_summary=anomaly_summary,
                trend_summary=trend_summary,
            )
            narrative = result.get("narrative", "")
            bullet_points = result.get("bullet_points", [])
        except Exception as e:
            print(f"NARRATIVE GEMINI ERROR [{logical_dataset_id}]: {e}")
            bullet_points = [
                f"Dataset '{ld.dataset_name}' contains {profiles[0].row_count if profiles else 0} rows across {len(profiles)} columns.",
                f"Anomaly detection identified {len(anomalies)} flagged values ({high} high severity).",
                "Narrative generation encountered an error. Re-mapping the dataset will retry this step.",
            ]
            narrative = "\n".join(f"• {b}" for b in bullet_points)

        # Upsert DatasetInsight
        existing = db.query(DatasetInsight).filter(DatasetInsight.logical_dataset_id == logical_dataset_id).first()
        if existing:
            existing.narrative = narrative
            existing.bullet_points = bullet_points
            existing.profile_snapshot = profile_snapshot
            import datetime
            existing.generated_at = datetime.datetime.utcnow()
        else:
            db.add(DatasetInsight(
                logical_dataset_id=logical_dataset_id,
                narrative=narrative,
                bullet_points=bullet_points,
                profile_snapshot=profile_snapshot,
            ))
        db.commit()
        return {"logical_dataset_id": logical_dataset_id, "status": "success"}

    except Exception as e:
        import traceback
        print(f"NARRATIVE TASK ERROR [{logical_dataset_id}]: {e}\n{traceback.format_exc()}")
        return {"logical_dataset_id": logical_dataset_id, "error": str(e)}
    finally:
        db.close()


# ─────────────────────────────────────────────
# Per-File Analytics Pipeline Tasks
# ─────────────────────────────────────────────

@app.task(bind=True)
def profile_single_dataset(self, dataset_id: str) -> dict:
    """Profile the raw uploaded table of a single Dataset (file-level stats)."""
    import pandas as pd
    import numpy as np
    from sqlalchemy import text as sa_text

    db: Session = SessionLocal()
    try:
        ds = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not ds:
            return {"error": f"Dataset {dataset_id} not found"}

        with engine.connect() as conn:
            result = conn.execute(sa_text(f'SELECT * FROM "{ds.table_name}"'))
            columns = list(result.keys())
            rows = result.fetchall()

        db.query(DatasetFileProfile).filter(DatasetFileProfile.dataset_id == dataset_id).delete()
        db.commit()

        if not rows:
            for col in columns:
                db.add(DatasetFileProfile(dataset_id=dataset_id, column_name=col, row_count=0))
            db.commit()
            return {"dataset_id": dataset_id, "columns_profiled": len(columns)}

        df = pd.DataFrame([dict(zip(columns, row)) for row in rows])

        def infer_dtype(series: pd.Series) -> str:
            if pd.api.types.is_float_dtype(series): return "float"
            if pd.api.types.is_integer_dtype(series): return "integer"
            if pd.api.types.is_bool_dtype(series): return "boolean"
            if pd.api.types.is_datetime64_any_dtype(series): return "timestamp"
            try:
                parsed = pd.to_datetime(series.dropna().astype(str).head(20), errors="raise")
                if len(parsed) > 0: return "timestamp"
            except Exception:
                pass
            return "string"

        row_count = len(df)
        profiles = []
        for col in df.columns:
            series = df[col]
            null_count = int(series.isna().sum())
            null_pct = round(null_count / row_count, 4) if row_count > 0 else 0.0
            distinct_count = int(series.nunique(dropna=True))
            data_type = infer_dtype(series)
            min_val = max_val = mean_val = median_val = std_val = None

            if data_type in ("float", "integer") and series.notna().sum() > 1:
                try:
                    numeric = pd.to_numeric(series.dropna(), errors="coerce").dropna()
                    if len(numeric) > 1:
                        min_val = str(numeric.min())
                        max_val = str(numeric.max())
                        mean_val = float(numeric.mean())
                        median_val = float(numeric.median())
                        std_val = float(numeric.std())
                except Exception:
                    pass
            else:
                try:
                    s = series.dropna().astype(str)
                    if len(s) > 0:
                        min_val = str(s.min())
                        max_val = str(s.max())
                except Exception:
                    pass

            try:
                vc = series.astype(str).value_counts().head(5)
                top_values = [{"value": str(v), "count": int(c)} for v, c in vc.items()]
            except Exception:
                top_values = []

            profiles.append(DatasetFileProfile(
                dataset_id=dataset_id,
                column_name=col,
                data_type=data_type,
                row_count=row_count,
                null_count=null_count,
                null_pct=null_pct,
                distinct_count=distinct_count,
                min_value=min_val,
                max_value=max_val,
                mean_value=mean_val,
                median_value=median_val,
                std_dev=std_val,
                top_values=top_values,
            ))

        db.bulk_save_objects(profiles)
        db.commit()
        return {"dataset_id": dataset_id, "columns_profiled": len(profiles)}

    except Exception as e:
        import traceback
        print(f"FILE PROFILE TASK ERROR [{dataset_id}]: {e}\n{traceback.format_exc()}")
        return {"dataset_id": dataset_id, "error": str(e)}
    finally:
        db.close()


@app.task(bind=True)
def detect_single_dataset_anomalies(self, profile_result: dict, dataset_id: str) -> dict:
    """Detect anomalies in a single uploaded file's raw table."""
    import pandas as pd
    import numpy as np
    from sqlalchemy import text as sa_text

    db: Session = SessionLocal()
    try:
        ds = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not ds:
            return {"error": f"Dataset {dataset_id} not found"}

        profiles = db.query(DatasetFileProfile).filter(DatasetFileProfile.dataset_id == dataset_id).all()
        if not profiles:
            return {"dataset_id": dataset_id, "anomalies_found": 0, "skipped_reason": "no_profile"}

        type_map = {p.column_name: p.data_type for p in profiles}
        row_count = profiles[0].row_count or 0
        if row_count == 0:
            return {"dataset_id": dataset_id, "anomalies_found": 0}

        sql = f'SELECT * FROM "{ds.table_name}"' if row_count <= 50000 else \
              f'SELECT * FROM "{ds.table_name}" TABLESAMPLE BERNOULLI(10)'

        with engine.connect() as conn:
            result = conn.execute(sa_text(sql))
            columns = list(result.keys())
            rows = result.fetchall()

        if not rows:
            return {"dataset_id": dataset_id, "anomalies_found": 0}

        df = pd.DataFrame([dict(zip(columns, row)) for row in rows])

        db.query(DatasetFileAnomaly).filter(DatasetFileAnomaly.dataset_id == dataset_id).delete()
        db.commit()

        from scipy.stats import zscore as scipy_zscore
        anomalies = []
        ANOMALY_CAP = 1000

        for col in df.columns:
            if len(anomalies) >= ANOMALY_CAP:
                break
            col_type = type_map.get(col, "string")

            if col_type in ("float", "integer"):
                numeric = pd.to_numeric(df[col], errors="coerce")
                valid_series = numeric.dropna()
                if valid_series.notna().sum() <= 1:
                    continue
                try:
                    z_scores = scipy_zscore(valid_series.astype(float))
                    zscore_flags = set()
                    for orig_idx, z in zip(valid_series.index, z_scores):
                        if abs(z) > 3:
                            severity = "high" if abs(z) > 4 else "medium"
                            zscore_flags.add(orig_idx)
                            if len(anomalies) < ANOMALY_CAP:
                                anomalies.append(DatasetFileAnomaly(
                                    dataset_id=dataset_id, column_name=col,
                                    row_index=int(orig_idx), value=str(df.at[orig_idx, col]),
                                    method="zscore", reason=f"Z-score {z:.2f} exceeds 3.0",
                                    severity=severity,
                                ))
                except Exception:
                    zscore_flags = set()

                try:
                    q1, q3 = float(valid_series.quantile(0.25)), float(valid_series.quantile(0.75))
                    iqr = q3 - q1
                    lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
                    for orig_idx, val in valid_series.items():
                        if val < lower or val > upper:
                            if orig_idx in zscore_flags:
                                for a in anomalies:
                                    if a.row_index == int(orig_idx) and a.column_name == col and a.method == "zscore":
                                        a.severity = "high"
                                        break
                            elif len(anomalies) < ANOMALY_CAP:
                                direction = "below" if val < lower else "above"
                                anomalies.append(DatasetFileAnomaly(
                                    dataset_id=dataset_id, column_name=col,
                                    row_index=int(orig_idx), value=str(val),
                                    method="iqr",
                                    reason=f"Value {val:.2f} is {direction} IQR boundary [{lower:.2f}, {upper:.2f}]",
                                    severity="medium",
                                ))
                except Exception:
                    pass

            elif col_type == "string":
                try:
                    vc = df[col].value_counts(dropna=True)
                    total = len(df)
                    for val, count in vc.items():
                        if count < 3 and (count / total) < 0.005:
                            for orig_idx in df.index[df[col] == val].tolist()[:3]:
                                if len(anomalies) < ANOMALY_CAP:
                                    anomalies.append(DatasetFileAnomaly(
                                        dataset_id=dataset_id, column_name=col,
                                        row_index=int(orig_idx), value=str(val),
                                        method="rare_categorical",
                                        reason=f"Value '{val}' appears {count} time(s) ({count/total*100:.2f}%)",
                                        severity="low",
                                    ))
                except Exception:
                    pass

        db.bulk_save_objects(anomalies)
        db.commit()
        return {"dataset_id": dataset_id, "anomalies_found": len(anomalies)}

    except Exception as e:
        import traceback
        print(f"FILE ANOMALY TASK ERROR [{dataset_id}]: {e}\n{traceback.format_exc()}")
        return {"dataset_id": dataset_id, "error": str(e)}
    finally:
        db.close()


@app.task(bind=True)
def generate_single_dataset_narrative(self, anomaly_result: dict, dataset_id: str) -> dict:
    """Generate an LLM narrative for a single uploaded file using its pre-computed stats."""
    db: Session = SessionLocal()
    try:
        ds = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not ds:
            return {"error": f"Dataset {dataset_id} not found"}

        profiles = db.query(DatasetFileProfile).filter(DatasetFileProfile.dataset_id == dataset_id).all()
        anomalies = db.query(DatasetFileAnomaly).filter(DatasetFileAnomaly.dataset_id == dataset_id).all()

        column_profiles = []
        for p in profiles:
            col_summary = {
                "column": p.column_name, "type": p.data_type,
                "null_pct": round(p.null_pct or 0, 3), "distinct_count": p.distinct_count,
            }
            if p.mean_value is not None:
                col_summary["mean"] = round(p.mean_value, 3)
                col_summary["std"] = round(p.std_dev or 0, 3)
            if p.top_values:
                col_summary["top_values"] = p.top_values[:3]
            column_profiles.append(col_summary)

        high = sum(1 for a in anomalies if a.severity == "high")
        medium = sum(1 for a in anomalies if a.severity == "medium")
        low = sum(1 for a in anomalies if a.severity == "low")
        anomaly_summary = {
            "total": len(anomalies), "high": high, "medium": medium, "low": low,
            "top_columns": list(dict.fromkeys(a.column_name for a in anomalies))[:5],
        }

        try:
            from .services.gemini import generate_narrative_with_ai
            result = generate_narrative_with_ai(
                dataset_name=ds.file_name,
                column_profiles=column_profiles,
                anomaly_summary=anomaly_summary,
                trend_summary=[],
            )
            narrative = result.get("narrative", "")
            bullet_points = result.get("bullet_points", [])
        except Exception as e:
            print(f"FILE NARRATIVE GEMINI ERROR [{dataset_id}]: {e}")
            bullet_points = [
                f"File '{ds.file_name}' contains {profiles[0].row_count if profiles else 0} rows across {len(profiles)} columns.",
                f"Anomaly detection flagged {len(anomalies)} values ({high} high severity).",
                "Narrative generation encountered an error. Re-uploading the file will retry this step.",
            ]
            narrative = "\n".join(f"• {b}" for b in bullet_points)

        existing = db.query(DatasetFileInsight).filter(DatasetFileInsight.dataset_id == dataset_id).first()
        if existing:
            existing.narrative = narrative
            existing.bullet_points = bullet_points
            import datetime
            existing.generated_at = datetime.datetime.utcnow()
        else:
            db.add(DatasetFileInsight(
                dataset_id=dataset_id, narrative=narrative, bullet_points=bullet_points,
            ))
        db.commit()
        return {"dataset_id": dataset_id, "status": "success"}

    except Exception as e:
        import traceback
        print(f"FILE NARRATIVE TASK ERROR [{dataset_id}]: {e}\n{traceback.format_exc()}")
        return {"dataset_id": dataset_id, "error": str(e)}
    finally:
        db.close()
