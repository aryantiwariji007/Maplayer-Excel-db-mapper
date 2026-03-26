import os
from sqlalchemy import create_engine, text

POSTGRES_USER = "maplayer"
POSTGRES_PASSWORD = "maplayer_password"
POSTGRES_DB = "maplayer_db"
POSTGRES_HOST = "localhost"
POSTGRES_PORT = "5432"

DATABASE_URL = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
engine = create_engine(DATABASE_URL)

def list_tables():
    with engine.connect() as conn:
        print("\n--- Analytics/Mapped Tables ---")
        tables = conn.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).fetchall()
        for t in tables:
            name = t[0]
            if name.startswith('mapped_') or name.startswith('analytics_'):
                count = conn.execute(text(f'SELECT count(1) FROM "{name}"')).scalar()
                print(f"Table: {name}, Count: {count}")

if __name__ == "__main__":
    list_tables()
