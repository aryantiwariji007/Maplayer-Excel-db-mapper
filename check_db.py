import os
from sqlalchemy import create_engine, text

POSTGRES_USER = os.getenv("POSTGRES_USER", "maplayer")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "maplayer_password")
POSTGRES_DB = os.getenv("POSTGRES_DB", "maplayer_db")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")

DATABASE_URL = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
engine = create_engine(DATABASE_URL)

def check_db_state():
    with engine.connect() as conn:
        ld_id = "74081a2b-f65a-4e65-9513-b820d361d0b0"
        ld = conn.execute(text("SELECT dataset_name, table_name FROM logical_datasets WHERE id = :id"), {"id": ld_id}).fetchone()
        if not ld:
            print("Logical dataset not found")
            return
        
        dataset_name, table_name = ld
        print(f"Logical Dataset: {dataset_name}, Table: {table_name}")
        
        try:
            res = conn.execute(text(f'SELECT * FROM "{table_name}" LIMIT 5'))
            cols = res.keys()
            rows = res.fetchall()
            print(f"Columns: {list(cols)}")
            print(f"Sample Data Rows: {len(rows)}")
        except Exception as e:
            print(f"Error querying table: {e}")

if __name__ == "__main__":
    check_db_state()
