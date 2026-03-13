import uuid
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from .database import Base

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
    created_at = Column(DateTime, server_default=func.now())

    logical_dataset = relationship("LogicalDataset", back_populates="mappings")


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
    logical_dataset_id = Column(String, ForeignKey("logical_datasets.id", ondelete="CASCADE"), nullable=False)
    sql_expression = Column(String, nullable=False)  # e.g., "AVG(temperature)"
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    logical_dataset = relationship("LogicalDataset")
