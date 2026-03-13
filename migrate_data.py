import sqlite3
import os
import json
from src.database import SessionLocal, engine
from src.models import TargetSchema, TargetColumn, CorrectionRecord, Base

Base.metadata.create_all(bind=engine)

def migrate():
    print("Starting migration from SQLite to Postgres...")
    sqlite_conn = sqlite3.connect('maplayer.db')
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_curr = sqlite_conn.cursor()

    db = SessionLocal()
    
    # Check if we already migrated
    if db.query(TargetSchema).count() > 0:
        print("Postgres already has schema data. Skipping migration.")
        return

    # Migrate Schemas
    schemas = sqlite_curr.execute("SELECT * FROM target_schemas").fetchall()
    for s in schemas:
        ts = TargetSchema(
            id=s['id'], 
            product_id=s['product_id'], 
            schema_name=s['schema_name'], 
            description=s['description']
        )
        db.add(ts)
    
    try:
        db.commit()
        print(f"Migrated {len(schemas)} schemas.")
    except Exception as e:
        print("Error migrating schemas:", e)
        db.rollback()

    # Migrate Columns
    columns = sqlite_curr.execute("SELECT * FROM target_columns").fetchall()
    for c in columns:
        tc = TargetColumn(
            id=c['id'], # Keep the same ID if possible, or omit to auto-increment
            schema_id=c['schema_id'],
            key=c['key'],
            label=c['label'],
            description=c['description'],
            data_type=c['data_type'],
            required=bool(c['required']),
            format_hint=c['format_hint'],
            examples=json.loads(c['examples']) if c['examples'] else [],
            aliases=json.loads(c['aliases']) if c['aliases'] else []
        )
        db.merge(tc) # Use merge to handle existing IDs
    
    try:
        db.commit()
        print(f"Migrated {len(columns)} columns.")
    except Exception as e:
        print("Error migrating columns:", e)
        db.rollback()

    db.close()
    print("Migration complete!")

if __name__ == "__main__":
    migrate()
