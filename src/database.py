import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

# Environment variables with cloud-first priority
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    POSTGRES_USER = os.getenv("PGUSER", os.getenv("POSTGRES_USER", "maplayer"))
    POSTGRES_PASSWORD = os.getenv("PGPASSWORD", os.getenv("POSTGRES_PASSWORD", "maplayer_password"))
    POSTGRES_DB = os.getenv("PGDATABASE", os.getenv("POSTGRES_DB", "maplayer_db"))
    POSTGRES_HOST = os.getenv("PGHOST", os.getenv("POSTGRES_HOST", "localhost"))
    POSTGRES_PORT = os.getenv("PGPORT", os.getenv("POSTGRES_PORT", "5432"))
    
    DATABASE_URL = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)
    _apply_migrations()

def _apply_migrations():
    """Apply safe, idempotent ALTER TABLE migrations for schema evolution."""
    migrations = [
        # Add schema_type to datasets (string: "static" | "dynamic")
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='datasets' AND column_name='schema_type'
            ) THEN
                ALTER TABLE datasets ADD COLUMN schema_type VARCHAR;
            END IF;
        END $$;
        """,
        # Add mapped_schema_name to datasets
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='datasets' AND column_name='mapped_schema_name'
            ) THEN
                ALTER TABLE datasets ADD COLUMN mapped_schema_name VARCHAR;
            END IF;
        END $$;
        """,
        # Add dataset_id to metrics to support single-file metrics
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='metrics' AND column_name='dataset_id'
            ) THEN
                ALTER TABLE metrics ADD COLUMN dataset_id VARCHAR REFERENCES datasets(id) ON DELETE CASCADE;
                ALTER TABLE metrics ALTER COLUMN logical_dataset_id DROP NOT NULL;
            END IF;
        END $$;
        """,
        # Add column_mapping to datasets
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='datasets' AND column_name='column_mapping'
            ) THEN
                ALTER TABLE datasets ADD COLUMN column_mapping JSONB;
            END IF;
        END $$;
        """,
    ]
    try:
        with engine.connect() as conn:
            for sql in migrations:
                conn.execute(text(sql))
            conn.commit()
        print("DEBUG: Database migrations applied successfully.")
    except Exception as e:
        print(f"WARNING: Migration step failed (non-fatal): {e}")

