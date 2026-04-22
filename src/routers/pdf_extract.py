"""
pdf_extract.py
─────────────────────────────────────────────
Endpoints for PDF page preview and AI-powered data extraction
mapped to a static TargetSchema.

  POST /pdf/preview  → render a page thumbnail (base64 PNG)
  POST /pdf/extract  → extract table data and persist as a Dataset
"""

import uuid
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db, engine
from ..models import Dataset, DatasetColumn, DatasetVersion, TargetSchema
from ..services.dataset_store import create_dataset_table, insert_dataset_rows
from ..services.gemini import extract_pdf_table_with_ai
from ..services.pdf_extractor import get_page_count, render_page_to_base64
from ..services.schema_inference import pg_type

router = APIRouter()

_DTYPE_ALIAS = {
    "text": "string",
    "string": "string",
    "number": "float",
    "date": "timestamp",
    "datetime": "timestamp",
    "timestamp": "timestamp",
    "integer": "integer",
    "float": "float",
    "boolean": "boolean",
    "json": "json",
}


@router.post("/preview")
async def pdf_page_preview(
    file: UploadFile = File(...),
    page_num: int = Form(...),
):
    """Return a base64-encoded thumbnail of a single PDF page (72 DPI)."""
    content = await file.read()
    try:
        page_count = get_page_count(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")

    if page_num < 1 or page_num > page_count:
        raise HTTPException(
            status_code=400,
            detail=f"Page {page_num} is out of range. This PDF has {page_count} page(s).",
        )

    thumbnail_b64 = render_page_to_base64(content, page_num, dpi=72)
    return {"page_image_b64": thumbnail_b64, "page_count": page_count, "page_num": page_num}


@router.post("/extract")
async def pdf_extract(
    file: UploadFile = File(...),
    page_num: int = Form(...),
    schema_id: str = Form(...),
    product_id: str = Form(...),
    hint: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Extract table data from a PDF page and persist it as a Dataset.

    Uses Gemini vision to map extracted rows to the chosen TargetSchema.
    """
    # ── Load schema ───────────────────────────────────────────────────────────
    schema = db.execute(
        select(TargetSchema).where(TargetSchema.id == schema_id)
    ).scalars().first()
    if not schema:
        raise HTTPException(status_code=404, detail=f"Schema '{schema_id}' not found.")

    if not schema.columns:
        raise HTTPException(
            status_code=400, detail="The selected schema has no columns defined."
        )

    # ── Render page ───────────────────────────────────────────────────────────
    content = await file.read()
    try:
        page_count = get_page_count(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")

    if page_num < 1 or page_num > page_count:
        raise HTTPException(
            status_code=400,
            detail=f"Page {page_num} is out of range. This PDF has {page_count} page(s).",
        )

    page_image_b64 = render_page_to_base64(content, page_num, dpi=150)

    # ── Build schema column descriptors for the prompt ────────────────────────
    schema_columns = [
        {
            "key": col.key,
            "label": col.label,
            "data_type": col.data_type,
            "description": col.description or "",
            "required": col.required,
            "format_hint": col.format_hint or "",
            "examples": col.examples or [],
        }
        for col in schema.columns
    ]

    # ── Call Gemini ───────────────────────────────────────────────────────────
    rows = extract_pdf_table_with_ai(page_image_b64, schema_columns, hint)
    if not rows:
        raise HTTPException(
            status_code=422,
            detail=(
                "No data could be extracted from this page matching the schema. "
                "Try adjusting the page number, schema selection, or adding an extraction hint."
            ),
        )

    # ── Build columns_meta from TargetColumn definitions ─────────────────────
    # Use schema keys directly as both column_name and normalized_name —
    # Gemini was instructed to use the exact schema key names.
    columns_meta = []
    for col in schema.columns:
        dtype = _DTYPE_ALIAS.get(col.data_type.lower(), "string")
        columns_meta.append(
            {
                "column_name": col.key,
                "normalized_name": col.key,
                "data_type": dtype,
                "pg_type": pg_type(dtype),
            }
        )

    # ── Convert to DataFrame ──────────────────────────────────────────────────
    df = pd.DataFrame(rows)
    # Ensure all schema columns exist in the DataFrame (fill missing with None)
    for col in columns_meta:
        if col["normalized_name"] not in df.columns:
            df[col["normalized_name"]] = None

    # ── Create dataset table and insert rows ──────────────────────────────────
    dataset_id = str(uuid.uuid4())
    table_name = f"upload_{dataset_id.replace('-', '_')}"

    create_dataset_table(engine, table_name, columns_meta)
    row_count = insert_dataset_rows(engine, table_name, df, columns_meta)

    # ── Persist Dataset metadata ──────────────────────────────────────────────
    safe_filename = (file.filename or "document.pdf").replace("/", "_")
    display_name = f"PDF: {safe_filename} (p{page_num})"

    column_mapping = {col.key: col.key for col in schema.columns}

    dataset = Dataset(
        id=dataset_id,
        product_id=product_id,
        file_name=display_name,
        table_name=table_name,
        row_count=row_count,
        schema_type="static",
        mapped_schema_name=schema.schema_name,
        column_mapping=column_mapping,
    )
    db.add(dataset)

    for col in columns_meta:
        db.add(
            DatasetColumn(
                dataset_id=dataset_id,
                column_name=col["column_name"],
                normalized_name=col["normalized_name"],
                data_type=col["data_type"],
            )
        )

    db.add(DatasetVersion(dataset_id=dataset_id, version=1, table_name=table_name))
    db.commit()

    # ── Build response ────────────────────────────────────────────────────────
    preview_rows = df.head(20).where(pd.notna(df.head(20)), None).to_dict(orient="records")
    columns_out = [{"name": c["normalized_name"], "type": c["data_type"]} for c in columns_meta]

    return {
        "dataset_id": dataset_id,
        "table_name": table_name,
        "row_count": row_count,
        "columns": columns_out,
        "preview_rows": preview_rows,
        "schema_name": schema.schema_name,
    }
