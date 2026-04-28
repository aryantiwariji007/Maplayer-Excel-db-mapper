"""
pdf_extract.py
─────────────────────────────────────────────
Endpoints for PDF page preview, table analysis, and AI-powered data extraction.

  POST /pdf/preview  → render a page thumbnail (base64 PNG)
  POST /pdf/analyze  → detect table columns + suggest best static schema
  POST /pdf/extract  → extract table data and persist as a Dataset
"""

import json
import uuid
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db, engine
from ..models import Dataset, DatasetColumn, DatasetVersion, TargetSchema
from ..schemas import DynamicColumnDef, PdfAnalyzeResponse
from ..services.dataset_store import create_dataset_table, insert_dataset_rows
from ..services.gemini import analyze_pdf_table, extract_pdf_table_with_ai
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


@router.post("/analyze", response_model=PdfAnalyzeResponse)
async def pdf_analyze(
    file: UploadFile = File(...),
    page_num: int = Form(...),
    product_id: str = Form(...),
    db: Session = Depends(get_db),
):
    """Detect table columns on a PDF page and find the best matching static schema."""
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

    # Build compact schema descriptors for the AI prompt
    all_schemas = db.execute(
        select(TargetSchema).where(TargetSchema.product_id == product_id)
    ).scalars().all()

    existing_schemas = [
        {
            "id": s.id,
            "name": s.schema_name,
            "columns": [
                {"key": col.key, "label": col.label, "data_type": col.data_type}
                for col in s.columns
            ],
        }
        for s in all_schemas
    ]

    result = analyze_pdf_table(page_image_b64, existing_schemas)
    return PdfAnalyzeResponse(**result)


@router.post("/extract")
async def pdf_extract(
    file: UploadFile = File(...),
    page_num: int = Form(...),
    product_id: str = Form(...),
    schema_id: Optional[str] = Form(None),
    dynamic_columns_json: Optional[str] = Form(None),
    hint: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Extract table data from a PDF page and persist it as a Dataset.

    Accepts either schema_id (static schema) or dynamic_columns_json (inline column list).
    """
    if not schema_id and not dynamic_columns_json:
        raise HTTPException(status_code=400, detail="Provide either schema_id or dynamic_columns_json.")
    if schema_id and dynamic_columns_json:
        raise HTTPException(status_code=400, detail="Provide only one of schema_id or dynamic_columns_json.")

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

    # ── Static schema path ────────────────────────────────────────────────────
    if schema_id:
        schema = db.execute(
            select(TargetSchema).where(TargetSchema.id == schema_id)
        ).scalars().first()
        if not schema:
            raise HTTPException(status_code=404, detail=f"Schema '{schema_id}' not found.")
        if not schema.columns:
            raise HTTPException(status_code=400, detail="The selected schema has no columns defined.")

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
        schema_type_value = "static"
        mapped_schema_name = schema.schema_name
        column_mapping = {col.key: col.key for col in schema.columns}
        columns_meta = [
            {
                "column_name": col.key,
                "normalized_name": col.key,
                "data_type": _DTYPE_ALIAS.get(col.data_type.lower(), "string"),
                "pg_type": pg_type(_DTYPE_ALIAS.get(col.data_type.lower(), "string")),
            }
            for col in schema.columns
        ]

    # ── Dynamic schema path ───────────────────────────────────────────────────
    else:
        try:
            raw = json.loads(dynamic_columns_json)  # type: ignore[arg-type]
            dynamic_cols = [DynamicColumnDef(**c) for c in raw]
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid dynamic_columns_json: {e}")

        if not dynamic_cols:
            raise HTTPException(status_code=400, detail="dynamic_columns_json must contain at least one column.")

        schema_columns = [
            {
                "key": col.key,
                "label": col.label,
                "data_type": col.data_type,
                "description": col.description or "",
                "required": False,
                "format_hint": col.format_hint or "",
                "examples": [],
            }
            for col in dynamic_cols
        ]
        schema_type_value = "dynamic"
        mapped_schema_name = f"Custom ({len(dynamic_cols)} columns)"
        column_mapping = {col.key: col.key for col in dynamic_cols}
        columns_meta = [
            {
                "column_name": col.key,
                "normalized_name": col.key,
                "data_type": _DTYPE_ALIAS.get(col.data_type.lower(), "string"),
                "pg_type": pg_type(_DTYPE_ALIAS.get(col.data_type.lower(), "string")),
            }
            for col in dynamic_cols
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

    # ── Convert to DataFrame ──────────────────────────────────────────────────
    df = pd.DataFrame(rows)
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
    preview_df = df.head(20).replace([float("inf"), float("-inf")], None)
    preview_rows = preview_df.where(pd.notna(preview_df), None).to_dict(orient="records")
    columns_out = [{"name": c["normalized_name"], "type": c["data_type"]} for c in columns_meta]

    return {
        "dataset_id": dataset_id,
        "table_name": table_name,
        "row_count": row_count,
        "columns": columns_out,
        "preview_rows": preview_rows,
        "schema_name": mapped_schema_name,
        "schema_mode": schema_type_value,
    }
