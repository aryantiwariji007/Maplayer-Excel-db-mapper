from pydantic import BaseModel, Field
from typing import List, Optional, Any
from datetime import datetime

class TargetColumnBase(BaseModel):
    key: str
    label: str
    description: Optional[str] = None
    data_type: str
    required: bool = False
    format_hint: Optional[str] = None
    examples: Optional[List[str]] = []
    aliases: Optional[List[str]] = []

class TargetColumnCreate(TargetColumnBase):
    pass

class TargetColumnResponse(TargetColumnBase):
    id: int
    schema_id: str

    class Config:
        from_attributes = True

class TargetSchemaBase(BaseModel):
    product_id: str
    schema_name: str
    description: Optional[str] = None

class TargetSchemaCreate(TargetSchemaBase):
    columns: List[TargetColumnCreate]

class TargetSchemaResponse(TargetSchemaBase):
    id: str
    created_at: datetime
    updated_at: datetime
    columns: List[TargetColumnResponse] = []

    class Config:
        from_attributes = True

# For Map endpoint
class MappingRequest(BaseModel):
    product_id: str
    schema_name: str

class CorrectionRequest(BaseModel):
    product_id: str
    schema_name: str
    source_column: str
    correct_target_key: str
    incorrect_target_key: Optional[str] = None

class CorrectionRecordResponse(CorrectionRequest):
    id: str
    occurrence_count: int
    created_at: datetime
    last_seen_at: datetime

    class Config:
        from_attributes = True


# ── Dynamic / Analyze Schema Models ──────────────────────────────────────────

class DynamicColumnDef(BaseModel):
    key: str
    label: str
    data_type: str = "string"
    description: Optional[str] = None
    format_hint: Optional[str] = None

class DetectedColumn(BaseModel):
    detected_header: str
    suggested_key: str
    data_type: str = "string"

class SchemaMatchSuggestion(BaseModel):
    schema_id: str
    schema_name: str
    confidence: float
    reason: str

class PdfAnalyzeResponse(BaseModel):
    detected_columns: List[DetectedColumn]
    best_match: Optional[SchemaMatchSuggestion] = None
    confidence_threshold: float = 0.7
