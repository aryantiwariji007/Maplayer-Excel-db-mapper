import io
import json
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import TargetSchema, TargetColumn
from ..schemas import CorrectionRequest
from ..services.corrections import (
    apply_corrections,
    get_corrections_for_schema,
    record_correction,
)
from ..services.data_processor import parse_file
from ..services.mapper import evaluate_best_match, score_mapping
from ..services.profiler import profile_column

router = APIRouter()

def process_mapping_for_schema(db: Session, schema: TargetSchema, df: pd.DataFrame):
    headers = df.columns.tolist()

    # Preload target columns as dicts for the mapper
    target_cols = db.execute(select(TargetColumn).where(TargetColumn.schema_id == schema.id)).scalars().all()
    fields = [
        {"key": c.key, "label": c.label, "data_type": c.data_type, "aliases": c.aliases}
        for c in target_cols
    ]

    # Pre-apply known corrections
    corrections = get_corrections_for_schema(db, schema.product_id, schema.id)
    known_mappings = apply_corrections(headers, corrections)

    mappings = []
    overall_confidence = 0.0

    for col in headers:
        if col in known_mappings:
            mappings.append({
                "column": col,
                "mapped_to": known_mappings[col]["correct_target_key"],
                "confidence": known_mappings[col]["confidence"],
                "reason": "Learned from previous corrections",
                "status": "ready"
            })
            overall_confidence += known_mappings[col]["confidence"]
            continue

        # Profile the column data
        profile = profile_column(col, df[col])
        inferred_type = profile["inferred_data_type"]

        # Run scoring engine
        best_match, ambiguities = score_mapping(col, inferred_type, schema.id, fields)

        if best_match:
            status = evaluate_best_match(best_match)
            mappings.append({
                "column": col,
                "mapped_to": best_match["target_key"] if status != "unmapped" else None,
                "confidence": best_match["final_score"],
                "reason": f"Matched via rules/semantics. Type: {inferred_type}",
                "status": status,
                "ambiguities": [a["target_key"] for a in ambiguities]
            })
            overall_confidence += best_match["final_score"]
        else:
            mappings.append({
                "column": col,
                "mapped_to": None,
                "confidence": 0.0,
                "reason": "No match found",
                "status": "unmapped"
            })
            
    avg_confidence = overall_confidence / len(headers) if headers else 0
    return mappings, avg_confidence

@router.post("/")
async def map_upload(
    product_id: str = Form(...),
    schema_name: Optional[str] = Form(default=None, description="Provide a schema name to map to specifically, or leave blank to auto-detect."),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Maps an uploaded file to a specific schema (or detects best) and returns mappings."""
    content = await file.read()
    if file.filename.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content))
    else:
        df = pd.read_excel(io.BytesIO(content))

    target_schema = None
    if schema_name:
        target_schema = db.execute(select(TargetSchema).where(
            TargetSchema.product_id == product_id,
            TargetSchema.schema_name == schema_name
        )).scalars().first()
        
        if not target_schema:
            raise HTTPException(status_code=404, detail=f"Schema '{schema_name}' not found for product '{product_id}'")
    else:
        # Auto-detect schema
        schemas = db.execute(select(TargetSchema).where(TargetSchema.product_id == product_id)).scalars().all()
        if not schemas:
            raise HTTPException(status_code=404, detail="No schemas found for product to auto-detect")

        best_score = -1
        for s in schemas:
            _, avg_confidence = process_mapping_for_schema(db, s, df)
            if avg_confidence > best_score:
                best_score = avg_confidence
                target_schema = s
        
        if not target_schema:
            raise HTTPException(status_code=404, detail="Could not reliably detect a target schema")

    mappings, _ = process_mapping_for_schema(db, target_schema, df)

    return {
        "file": file.filename,
        "detected_schema": target_schema.schema_name,
        "total_rows_detected": len(df),
        "mappings": mappings
    }

@router.post("/confirm")
def map_confirm(req: CorrectionRequest, db: Session = Depends(get_db)):
    """Records a user's manual correction for a schema matching."""
    schema = db.execute(select(TargetSchema).where(
        TargetSchema.product_id == req.product_id,
        TargetSchema.schema_name == req.schema_name
    )).scalars().first()
    
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")

    record = record_correction(
        db=db,
        product_id=req.product_id,
        schema_id=schema.id,
        source_column=req.source_column,
        correct_target=req.correct_target_key,
        incorrect_target=req.incorrect_target_key
    )

    return {"message": "Correction recorded successfully", "record_id": record.id}

@router.post("/detect-schema")
async def detect_schema(
    product_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Profiles a file and detects the best matching target schema."""
    schemas = db.execute(select(TargetSchema).where(TargetSchema.product_id == product_id)).scalars().all()
    if not schemas:
        raise HTTPException(status_code=404, detail="No schemas found for product")

    content = await file.read()
    if file.filename.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content))
    else:
        df = pd.read_excel(io.BytesIO(content))

    best_schema = None
    best_score = -1
    best_mappings = None

    for schema in schemas:
        mappings, avg_confidence = process_mapping_for_schema(db, schema, df)
        if avg_confidence > best_score:
            best_score = avg_confidence
            best_schema = schema
            best_mappings = mappings

    return {
        "detected_schema": best_schema.schema_name if best_schema else None,
        "confidence": best_score,
        "mappings": best_mappings
    }

@router.post("/auto-transform")
async def auto_transform(
    product_id: str = Form(...),
    schema_name: Optional[str] = Form(default=None, description="Provide a schema name to map to specifically, or leave blank to auto-detect."),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Maps the file (auto-detecting schema if not provided) and returns a transformed dataset."""
    content = await file.read()
    if file.filename.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content))
    else:
        df = pd.read_excel(io.BytesIO(content))

    target_schema = None
    if schema_name:
        target_schema = db.execute(select(TargetSchema).where(
            TargetSchema.product_id == product_id,
            TargetSchema.schema_name == schema_name
        )).scalars().first()
        
        if not target_schema:
            raise HTTPException(status_code=404, detail=f"Schema '{schema_name}' not found")
    else:
        # Auto-detect schema
        schemas = db.execute(select(TargetSchema).where(TargetSchema.product_id == product_id)).scalars().all()
        if not schemas:
            raise HTTPException(status_code=404, detail="No schemas found for product")

        best_score = -1
        for s in schemas:
            _, avg_confidence = process_mapping_for_schema(db, s, df)
            if avg_confidence > best_score:
                best_score = avg_confidence
                target_schema = s
        
        if not target_schema:
            raise HTTPException(status_code=404, detail="Could not detect schema automatically")

    mappings, _ = process_mapping_for_schema(db, target_schema, df)
    
    # Apply mappings
    transformed_data = []
    
    # Create an inverse map: Map target_key -> col name
    target_to_source = {
        m["mapped_to"]: m["column"]
        for m in mappings
        if m.get("mapped_to") is not None
    }
    
    for idx, row in df.iterrows():
        new_row = {}
        for target, source in target_to_source.items():
            val = row.get(source)
            new_row[target] = None if pd.isna(val) else val
            
        if new_row:
            transformed_data.append(new_row)

    return {"transformed_rows": transformed_data}

@router.post("/transform")
async def manual_transform(
    file: UploadFile = File(...),
    mappings_json: str = Form(...),
):
    """Takes user confirmed mappings and returns a transformed dataset."""
    try:
        confirmed_mappings = json.loads(mappings_json)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid mappings_json provided")

    content = await file.read()
    if file.filename.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content))
    else:
        df = pd.read_excel(io.BytesIO(content))
        
    transformed_data = []
    
    # Expect confirmed_mappings to be [{"source": "A", "target": "target_A"}]
    for idx, row in df.iterrows():
        new_row = {}
        for m in confirmed_mappings:
            source = m.get("source")
            target = m.get("target")
            if source and target:
                val = row.get(source)
                new_row[target] = None if pd.isna(val) else val
        if new_row:
            transformed_data.append(new_row)
        
    return {"transformed_rows": transformed_data}
