import uuid
import threading
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
from ..database import get_db
from ..models import TargetSchema, TargetColumn
from ..schemas import TargetSchemaCreate, TargetSchemaResponse, TargetSchemaUpdate
from ..services.qdrant_service import sync_schema_embeddings

router = APIRouter()

from typing import Optional

@router.get("/", response_model=list[TargetSchemaResponse])
def list_schemas(product_id: Optional[str] = None, db: Session = Depends(get_db)):
    stmt = select(TargetSchema)
    if product_id:
        stmt = stmt.where(TargetSchema.product_id == product_id)
    
    result = db.execute(stmt)
    schemas = result.scalars().unique().all()
    return schemas

@router.post("/", response_model=TargetSchemaResponse)
def create_schema(schema: TargetSchemaCreate, db: Session = Depends(get_db)):
    # Check if exists
    result = db.execute(
        select(TargetSchema).where(
            TargetSchema.product_id == schema.product_id,
            TargetSchema.schema_name == schema.schema_name
        )
    )
    existing = result.scalars().first()
    if existing:
        raise HTTPException(status_code=400, detail="Schema already exists for this product")

    db_schema = TargetSchema(
        id=str(uuid.uuid4()),
        product_id=schema.product_id,
        schema_name=schema.schema_name,
        description=schema.description
    )
    
    for col in schema.columns:
        db_col = TargetColumn(
            key=col.key,
            label=col.label,
            description=col.description,
            data_type=col.data_type,
            required=col.required,
            format_hint=col.format_hint,
            examples=col.examples,
            aliases=col.aliases
        )
        db_schema.columns.append(db_col)
        
    db.add(db_schema)
    db.commit()
    db.refresh(db_schema)
    
    # Sync with Qdrant in background to avoid blocking the response
    schema_id = db_schema.id
    columns_snapshot = list(db_schema.columns)
    threading.Thread(
        target=lambda: sync_schema_embeddings(schema_id, columns_snapshot),
        daemon=True
    ).start()

    return db_schema

@router.get("/{schema_id}", response_model=TargetSchemaResponse)
def get_schema(schema_id: str, db: Session = Depends(get_db)):
    result = db.execute(select(TargetSchema).where(TargetSchema.id == schema_id))
    schema = result.scalars().first()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")
    return schema

@router.put("/{schema_id}", response_model=TargetSchemaResponse)
def update_schema(schema_id: str, update: TargetSchemaUpdate, db: Session = Depends(get_db)):
    result = db.execute(select(TargetSchema).where(TargetSchema.id == schema_id))
    schema = result.scalars().first()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")

    if update.schema_name is not None:
        schema.schema_name = update.schema_name
    if update.description is not None:
        schema.description = update.description

    if update.columns is not None:
        for col in list(schema.columns):
            db.delete(col)
        db.flush()
        for col in update.columns:
            db_col = TargetColumn(
                key=col.key,
                label=col.label,
                description=col.description,
                data_type=col.data_type,
                required=col.required,
                format_hint=col.format_hint,
                examples=col.examples,
                aliases=col.aliases,
            )
            schema.columns.append(db_col)

    db.commit()
    db.refresh(schema)

    schema_id_val = schema.id
    columns_snapshot = list(schema.columns)
    threading.Thread(
        target=lambda: sync_schema_embeddings(schema_id_val, columns_snapshot),
        daemon=True,
    ).start()

    return schema

@router.delete("/{schema_id}")
def delete_schema(schema_id: str, db: Session = Depends(get_db)):
    result = db.execute(select(TargetSchema).where(TargetSchema.id == schema_id))
    schema = result.scalars().first()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")
        
    db.delete(schema)
    db.commit()
    return {"message": "Schema deleted successfully"}
