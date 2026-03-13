"""
dataset_store.py
─────────────────────────────────────────────
Handles dynamic Postgres table creation and bulk data insertion
for the Dynamic Schema Ingestion Platform.
"""

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine


def create_dataset_table(engine: Engine, table_name: str, columns: list[dict]) -> None:
    """
    Dynamically CREATE a Postgres table for a new dataset.
    `columns` is a list of dicts: {normalized_name, pg_type}
    """
    col_defs = ",\n    ".join(
        f'"{c["normalized_name"]}" {c["pg_type"]}' for c in columns
    )
    ddl = f"""
    CREATE TABLE IF NOT EXISTS "{table_name}" (
        _row_id SERIAL PRIMARY KEY,
        {col_defs}
    );
    """
    with engine.connect() as conn:
        conn.execute(text(ddl))
        conn.commit()


def insert_dataset_rows(
    engine: Engine,
    table_name: str,
    df: pd.DataFrame,
    columns: list[dict],
) -> int:
    """
    Bulk-insert DataFrame rows into the dynamic table.
    Renames df columns to their normalized names before inserting.
    Returns number of rows inserted.
    """
    # Build rename map: original column name → normalized name
    rename_map = {c["column_name"]: c["normalized_name"] for c in columns}
    df_insert = df.rename(columns=rename_map)

    # Only keep columns we know about (drop any leftover unnamed columns)
    valid_cols = [c["normalized_name"] for c in columns]
    df_insert = df_insert[[col for col in valid_cols if col in df_insert.columns]]

    # Replace NaN with None (psycopg2 handles None as NULL)
    df_insert = df_insert.where(pd.notna(df_insert), None)

    # Explicitly cast boolean columns to handle string/int inputs
    for col in columns:
        if col["data_type"] == "boolean" and col["normalized_name"] in df_insert.columns:
            # Map common truthy/falsy values to actual booleans
            df_insert[col["normalized_name"]] = df_insert[col["normalized_name"]].apply(
                lambda x: str(x).lower() in ("true", "yes", "y", "1", "t") if x is not None else None
            )

    # Use pandas to_sql with method='multi' for batch inserts
    df_insert.to_sql(
        table_name,
        con=engine,
        if_exists="append",
        index=False,
        method="multi",
        chunksize=500,
    )
    return len(df_insert)


def drop_dataset_table(engine: Engine, table_name: str) -> None:
    """Drops the physical table for a dataset (used in cleanup/rollback)."""
    with engine.connect() as conn:
        conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}"'))
        conn.commit()


def query_dataset(engine: Engine, sql: str) -> dict:
    """
    Executes a raw SQL query and returns columns + rows.
    Used by the analytics layer.
    """
    with engine.connect() as conn:
        result = conn.execute(text(sql))
        columns = list(result.keys())
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
    return {"columns": columns, "rows": rows}


def create_analytics_table(engine: Engine, table_name: str, mapping: dict, source_columns: list[dict]) -> None:
    """
    Dynamically CREATE the physical analytics table if it doesn't exist.
    `mapping` is { "source_col": "target_col" }
    `source_columns` is the list of column dicts from the first mapped dataset.
    """
    col_defs = []
    source_type_map = {c["column_name"]: c["pg_type"] for c in source_columns}
    # Also support mapping by normalized_name if that's what is passed
    source_type_map.update({c["normalized_name"]: c["pg_type"] for c in source_columns})
    
    for source_col, target_col in mapping.items():
        pg_type = source_type_map.get(source_col, "TEXT")
        col_defs.append(f'"{target_col}" {pg_type}')
    
    col_defs_str = ",\n        ".join(col_defs)
    
    ddl = f"""
    CREATE TABLE IF NOT EXISTS "{table_name}" (
        _analytics_id SERIAL PRIMARY KEY,
        dataset_id VARCHAR(255) NOT NULL,
        {col_defs_str}
    );
    """
    with engine.connect() as conn:
        conn.execute(text(ddl))
        conn.commit()


def append_to_analytics_table(
    engine: Engine,
    analytics_table: str,
    source_table: str,
    mapping: dict,
    dataset_id: str
) -> None:
    """
    INSERT INTO the materialized analytics table from a source uploaded dataset table.
    """
    source_cols = []
    target_cols = []
    for source_col, target_col in mapping.items():
        source_cols.append(f'"{source_col}"')
        target_cols.append(f'"{target_col}"')
        
    source_cols_str = ", ".join(source_cols)
    target_cols_str = ", ".join(target_cols)
    
    sql = f"""
    INSERT INTO "{analytics_table}" (dataset_id, {target_cols_str})
    SELECT '{dataset_id}', {source_cols_str}
    FROM "{source_table}";
    """
    with engine.connect() as conn:
        conn.execute(text(sql))
        conn.commit()


def get_table_columns(engine: Engine, table_name: str) -> list[str]:
    """Retrieve existing column names from a table."""
    with engine.connect() as conn:
        # We query one row to get column keys safely
        res = conn.execute(text(f'SELECT * FROM "{table_name}" LIMIT 0'))
        return list(res.keys())


def add_columns_to_analytics_table(engine: Engine, table_name: str, new_columns: dict) -> None:
    """
    Execute ALTER TABLE ADD COLUMN for schema evolution.
    `new_columns` is { "column_name": "pg_type" }
    """
    if not new_columns:
        return
        
    alter_cmds = []
    for col_name, pg_type in new_columns.items():
        alter_cmds.append(f'ADD COLUMN "{col_name}" {pg_type}')
        
    alter_sql = f'ALTER TABLE "{table_name}" ' + ", ".join(alter_cmds) + ";"
    with engine.connect() as conn:
        conn.execute(text(alter_sql))
        conn.commit()
