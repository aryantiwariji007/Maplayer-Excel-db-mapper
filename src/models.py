import uuid
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint, Text, Float, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from .database import Base
import datetime

def generate_uuid():
    return str(uuid.uuid4())

class TargetSchema(Base):
    __tablename__ = "target_schemas"

    id = Column(String, primary_key=True, default=generate_uuid)
    product_id = Column(String, nullable=False)
    schema_name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    columns = relationship("TargetColumn", back_populates="schema", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint('product_id', 'schema_name', name='uix_product_schema'),
    )

class TargetColumn(Base):
    __tablename__ = "target_columns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    schema_id = Column(String, ForeignKey("target_schemas.id", ondelete="CASCADE"), nullable=False)
    key = Column(String, nullable=False)
    label = Column(String, nullable=False)
    description = Column(String, nullable=True)
    data_type = Column(String, nullable=False)
    required = Column(Boolean, nullable=False, default=False)
    format_hint = Column(String, nullable=True)
    
    examples = Column(JSONB, nullable=True, default=list)
    aliases = Column(JSONB, nullable=True, default=list)

    schema = relationship("TargetSchema", back_populates="columns")

class CorrectionRecord(Base):
    __tablename__ = "correction_records"

    id = Column(String, primary_key=True, default=generate_uuid)
    product_id = Column(String, nullable=False)
    schema_id = Column(String, nullable=False)
    source_column_name = Column(String, nullable=False)
    correct_target_key = Column(String, nullable=False)
    incorrect_target_key = Column(String, nullable=True)
    occurrence_count = Column(Integer, default=1)
    
    created_at = Column(DateTime, server_default=func.now())
    last_seen_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('product_id', 'schema_id', 'source_column_name', 'correct_target_key', name='uix_corr_prod_schema_src_tgt'),
    )

class ApiClient(Base):
    __tablename__ = "api_clients"

    id = Column(String, primary_key=True, default=generate_uuid)
    client_name = Column(String, nullable=False)
    api_key = Column(String, unique=True, nullable=False)
    product_id = Column(String, nullable=False)
    rate_limit = Column(Integer, default=1000)
    created_at = Column(DateTime, server_default=func.now())


# ─────────────────────────────────────────────
# Dynamic Ingestion Platform Models
# ─────────────────────────────────────────────

class Dataset(Base):
    """Registry of uploaded files and their dynamically inferred schemas."""
    __tablename__ = "datasets"

    id = Column(String, primary_key=True, default=generate_uuid)
    product_id = Column(String, nullable=False, index=True)
    file_name = Column(String, nullable=False)
    table_name = Column(String, nullable=False, unique=True)  # e.g. upload_<uuid>
    row_count = Column(Integer, default=0)
    schema_type = Column(String, nullable=True)       # "static" | "dynamic" | None
    mapped_schema_name = Column(String, nullable=True)  # name of the matched schema
    column_mapping = Column(JSONB, nullable=True)     # stored column mapping for re-mapping
    created_at = Column(DateTime, server_default=func.now())

    columns = relationship("DatasetColumn", back_populates="dataset", cascade="all, delete-orphan")
    versions = relationship("DatasetVersion", back_populates="dataset", cascade="all, delete-orphan")



class DatasetColumn(Base):
    """Metadata about each column in a dynamically ingested dataset."""
    __tablename__ = "dataset_columns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    column_name = Column(String, nullable=False)       # original name from file
    normalized_name = Column(String, nullable=False)   # cleaned/safe DB column name
    data_type = Column(String, nullable=False)         # string|integer|float|boolean|timestamp|json

    dataset = relationship("Dataset", back_populates="columns")


class LogicalDataset(Base):
    """A named logical concept that groups multiple similar uploaded datasets."""
    __tablename__ = "logical_datasets"

    id = Column(String, primary_key=True, default=generate_uuid)
    product_id = Column(String, nullable=False, index=True)
    dataset_name = Column(String, nullable=False)   # e.g. 'temperature_metrics'
    description = Column(Text, nullable=True)
    table_name = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    mappings = relationship("LogicalDatasetMapping", back_populates="logical_dataset", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint('product_id', 'dataset_name', name='uix_logical_product_name'),
    )


class LogicalDatasetMapping(Base):
    """Maps a physical Dataset to a LogicalDataset, with column alignment."""
    __tablename__ = "logical_dataset_mappings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    logical_dataset_id = Column(String, ForeignKey("logical_datasets.id", ondelete="CASCADE"), nullable=False)
    dataset_id = Column(String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    column_mapping = Column(JSONB, nullable=False, default=dict)  # {"source_col": "logical_col"}
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    logical_dataset = relationship("LogicalDataset", back_populates="mappings")


class MappingHistory(Base):
    """Archived snapshots of LogicalDatasetMapping — written before each overwrite."""
    __tablename__ = "mapping_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    logical_dataset_id = Column(String, nullable=False)
    column_mapping = Column(JSONB, nullable=False, default=dict)
    version = Column(Integer, nullable=False, default=1)
    superseded_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    created_at = Column(DateTime, server_default=func.now())


class DatasetVersion(Base):
    """Tracks versions of a dataset — each upload creates a version."""
    __tablename__ = "dataset_versions"

    id = Column(String, primary_key=True, default=generate_uuid)
    dataset_id = Column(String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    table_name = Column(String, nullable=False)  # snapshot table name
    created_at = Column(DateTime, server_default=func.now())

    dataset = relationship("Dataset", back_populates="versions")


class Metric(Base):
    """Semantic business metric definition over a logical dataset."""
    __tablename__ = "metrics"

    id = Column(String, primary_key=True, default=generate_uuid)
    product_id = Column(String, nullable=False, index=True)
    metric_name = Column(String, nullable=False)
    logical_dataset_id = Column(String, ForeignKey("logical_datasets.id", ondelete="CASCADE"), nullable=True)
    dataset_id = Column(String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=True)
    sql_expression = Column(String, nullable=False)  # e.g., "AVG(temperature)"
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    logical_dataset = relationship("LogicalDataset")
    dataset = relationship("Dataset")


class UploadJob(Base):
    """Tracks the status of an asynchronous background upload/ingestion job."""
    __tablename__ = "upload_jobs"

    id = Column(String, primary_key=True, default=generate_uuid)
    product_id = Column(String, nullable=False, index=True)
    status = Column(String, default="PENDING")  # PENDING, PROCESSING, COMPLETED, FAILED
    total_files = Column(Integer, default=0)
    processed_files = Column(Integer, default=0)
    results = Column(JSONB, nullable=True, default=list)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ─────────────────────────────────────────────
# Post-Processing Analytics Pipeline Models
# ─────────────────────────────────────────────

class DatasetProfile(Base):
    """Statistical profile for each column of a LogicalDataset, computed post-mapping."""
    __tablename__ = "dataset_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    logical_dataset_id = Column(String, ForeignKey("logical_datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    column_name = Column(String, nullable=False)
    data_type = Column(String, nullable=True)       # string|integer|float|boolean|timestamp
    row_count = Column(Integer, nullable=True)
    null_count = Column(Integer, nullable=True)
    null_pct = Column(Float, nullable=True)         # 0.0–1.0
    distinct_count = Column(Integer, nullable=True)
    min_value = Column(Text, nullable=True)         # serialized as string for universal type support
    max_value = Column(Text, nullable=True)
    mean_value = Column(Float, nullable=True)       # None for non-numeric
    median_value = Column(Float, nullable=True)
    std_dev = Column(Float, nullable=True)
    top_values = Column(JSONB, nullable=True)       # [{"value": "X", "count": 12}, ...]
    computed_at = Column(DateTime, server_default=func.now())

    logical_dataset = relationship("LogicalDataset")

    __table_args__ = (
        UniqueConstraint('logical_dataset_id', 'column_name', name='uix_profile_ld_col'),
    )


class DataAnomaly(Base):
    """Flagged anomalous rows/values in a LogicalDataset, detected post-profiling."""
    __tablename__ = "data_anomalies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    logical_dataset_id = Column(String, ForeignKey("logical_datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    column_name = Column(String, nullable=False)
    row_index = Column(Integer, nullable=True)      # row position in materialized table
    value = Column(Text, nullable=True)             # stringified value
    method = Column(String, nullable=False)         # "zscore" | "iqr" | "rare_categorical"
    reason = Column(Text, nullable=True)            # human-readable explanation
    severity = Column(String, nullable=False, default="medium")  # "low" | "medium" | "high"
    computed_at = Column(DateTime, server_default=func.now())

    logical_dataset = relationship("LogicalDataset")


class TrendAnalysis(Base):
    """Time-series trend data for numeric columns in a LogicalDataset."""
    __tablename__ = "trend_analyses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    logical_dataset_id = Column(String, ForeignKey("logical_datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    time_column = Column(String, nullable=False)    # detected timestamp column
    value_column = Column(String, nullable=False)   # numeric column being trended
    period = Column(String, nullable=False)         # "month"
    direction = Column(String, nullable=True)       # "up" | "down" | "flat"
    slope = Column(Float, nullable=True)            # linear regression slope
    r_squared = Column(Float, nullable=True)        # goodness-of-fit
    series_data = Column(JSONB, nullable=True)      # [{"period": "2024-01", "value": 123.4}, ...]
    computed_at = Column(DateTime, server_default=func.now())

    logical_dataset = relationship("LogicalDataset")

    __table_args__ = (
        UniqueConstraint('logical_dataset_id', 'time_column', 'value_column', 'period', name='uix_trend_ld_cols'),
    )


class DatasetInsight(Base):
    """LLM-generated narrative summary for a LogicalDataset, derived from profile + anomaly data."""
    __tablename__ = "dataset_insights"

    id = Column(Integer, primary_key=True, autoincrement=True)
    logical_dataset_id = Column(String, ForeignKey("logical_datasets.id", ondelete="CASCADE"), nullable=False, unique=True)
    narrative = Column(Text, nullable=False)
    bullet_points = Column(JSONB, nullable=True)    # ["...", "...", "..."]
    generated_at = Column(DateTime, server_default=func.now())
    profile_snapshot = Column(JSONB, nullable=True) # compact stats snapshot sent to Gemini (for auditability)

    logical_dataset = relationship("LogicalDataset")


# ─────────────────────────────────────────────
# Per-File Analytics Models
# ─────────────────────────────────────────────

class DatasetFileProfile(Base):
    """Statistical profile per column for a single uploaded file."""
    __tablename__ = "dataset_file_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    column_name = Column(String, nullable=False)
    data_type = Column(String, nullable=True)
    row_count = Column(Integer, nullable=True)
    null_count = Column(Integer, nullable=True)
    null_pct = Column(Float, nullable=True)
    distinct_count = Column(Integer, nullable=True)
    min_value = Column(Text, nullable=True)
    max_value = Column(Text, nullable=True)
    mean_value = Column(Float, nullable=True)
    median_value = Column(Float, nullable=True)
    std_dev = Column(Float, nullable=True)
    top_values = Column(JSONB, nullable=True)
    computed_at = Column(DateTime, server_default=func.now())

    dataset = relationship("Dataset")

    __table_args__ = (
        UniqueConstraint('dataset_id', 'column_name', name='uix_file_profile_ds_col'),
    )


class DatasetFileAnomaly(Base):
    """Anomaly detection results for a single uploaded file."""
    __tablename__ = "dataset_file_anomalies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    column_name = Column(String, nullable=False)
    row_index = Column(Integer, nullable=True)
    value = Column(Text, nullable=True)
    method = Column(String, nullable=False)
    reason = Column(Text, nullable=True)
    severity = Column(String, nullable=False, default="medium")
    computed_at = Column(DateTime, server_default=func.now())

    dataset = relationship("Dataset")


class DatasetFileInsight(Base):
    """LLM-generated narrative for a single uploaded file."""
    __tablename__ = "dataset_file_insights"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_id = Column(String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, unique=True)
    narrative = Column(Text, nullable=False)
    bullet_points = Column(JSONB, nullable=True)
    generated_at = Column(DateTime, server_default=func.now())

    dataset = relationship("Dataset")
