from sqlalchemy import create_engine, text
import os

POSTGRES_USER = os.getenv("POSTGRES_USER", "maplayer")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "maplayer_password")
POSTGRES_DB = os.getenv("POSTGRES_DB", "maplayer_db")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")

DATABASE_URL = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    res = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'analytics_19fc13c9_effc_45d9_9eb7_b8634ce6b9e4'"))
    print([r[0] for r in res.fetchall()])
