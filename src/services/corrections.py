from sqlalchemy.orm import Session
from sqlalchemy import select
from ..models import CorrectionRecord

def get_corrections_for_schema(db: Session, product_id: str, schema_id: str):
    """Retrieves all correction records for a given schema."""
    result = db.execute(
        select(CorrectionRecord)
        .where(CorrectionRecord.product_id == product_id, CorrectionRecord.schema_id == schema_id)
        .order_by(CorrectionRecord.occurrence_count.desc())
    )
    return result.scalars().all()

def apply_corrections(source_columns: list[str], corrections: list[CorrectionRecord]):
    """Applies known corrections to source columns to pre-map them before AI."""
    correction_map = {}
    for c in corrections:
        if c.correct_target_key:
            correction_map[c.source_column_name.lower()] = {
                "correct_target_key": c.correct_target_key,
                "confidence": min(0.5 + (c.occurrence_count * 0.1), 1.0)
            }
            
    results = {}
    for source in source_columns:
        source_lower = str(source).lower()
        if source_lower in correction_map:
            results[source] = correction_map[source_lower]
            
    return results

def record_correction(db: Session, product_id: str, schema_id: str, source_column: str, correct_target: str, incorrect_target: str = None):
    """Upserts a correction record."""
    result = db.execute(
        select(CorrectionRecord)
        .where(
            CorrectionRecord.product_id == product_id,
            CorrectionRecord.schema_id == schema_id,
            CorrectionRecord.source_column_name == source_column,
            CorrectionRecord.correct_target_key == correct_target
        )
    )
    record = result.scalars().first()

    if record:
        record.occurrence_count += 1
    else:
        record = CorrectionRecord(
            product_id=product_id,
            schema_id=schema_id,
            source_column_name=source_column,
            correct_target_key=correct_target,
            incorrect_target_key=incorrect_target,
            occurrence_count=1
        )
        db.add(record)
    
    db.commit()
    db.refresh(record)
    return record
