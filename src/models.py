import uuid
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint, func
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
