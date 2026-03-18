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
    # We do this AFTER renaming but BEFORE type-specific processing
    df_insert = df_insert.where(pd.notna(df_insert), None)

    # ── Explicit Type Casting ─────────────────────────────────────────────
    # This prevents failures when pandas infers a loose type (like object or float64)
    # but the database table has a strict type (like BIGINT).
    for col in columns:
        col_name = col["normalized_name"]
        if col_name not in df_insert.columns:
            continue
            
        dtype = col["data_type"]
        
        if dtype == "boolean":
            df_insert[col_name] = df_insert[col_name].apply(
                lambda x: str(x).lower() in ("true", "yes", "y", "1", "t") if x is not None else None
            )
        elif dtype == "integer":
            # Convert to numeric first, then to nullable Int64 (pandas) or None
            # Using Series.map() to ensure we keep None as NULL
            def cast_int(v):
                if v is None: return None
                try: return int(float(v))
                except: return None
            df_insert[col_name] = df_insert[col_name].map(cast_int)
        elif dtype == "float":
            def cast_float(v):
                if v is None: return None
                try: return float(v)
                except: return None
            df_insert[col_name] = df_insert[col_name].map(cast_float)
        elif dtype == "timestamp":
            # Ensure col is datetime object
            df_insert[col_name] = pd.to_datetime(df_insert[col_name], errors="coerce")
            # Convert NaT back to None for SQL
            df_insert[col_name] = df_insert[col_name].where(df_insert[col_name].notnull(), None)

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
    source_type_map = {c.get("column_name", c.get("normalized_name", "")): c.get("pg_type", "TEXT") for c in source_columns}
    # Also support mapping by normalized_name if that's what is passed
    source_type_map.update({c.get("normalized_name", ""): c.get("pg_type", "TEXT") for c in source_columns})
    
    for source_col, target_col in mapping.items():
        pg_type = source_type_map.get(source_col, "TEXT")
        col_defs.append(f'"{target_col}" {pg_type}')
    
    if col_defs:
        col_defs_str = ",\n        " + ",\n        ".join(col_defs)
    else:
        col_defs_str = ""
    
    ddl = f"""
    CREATE TABLE IF NOT EXISTS "{table_name}" (
        _analytics_id SERIAL PRIMARY KEY,
        dataset_id VARCHAR(255) NOT NULL{col_defs_str}
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
    Now with intelligent source-to-target casting.
    """
    # 1. Inspect both source and target types
    target_types = get_table_schema_dict(engine, analytics_table)
    source_types = get_table_schema_dict(engine, source_table)
    
    source_cols_exprs = []
    target_cols = []
    
    # 2. Build explicit casts for each mapped column
    for src, tgt in mapping.items():
        target_type = target_types.get(tgt, "text").lower()
        source_type = source_types.get(src, "text").lower()
        
        # Build a safe casting expression
        if "timestamp" in target_type:
            # Source can be timestamp, text, or bigint
            source_cols_exprs.append(f'"{src}"::timestamp')
        elif "int" in target_type or "bigint" in target_type:
            # Special check: timestamp to bigint requires explicit epoch extraction
            if "timestamp" in source_type:
                source_cols_exprs.append(f'EXTRACT(EPOCH FROM "{src}")::bigint')
            else:
                source_cols_exprs.append(f'"{src}"::bigint')
        elif "numeric" in target_type or "double" in target_type or "float" in target_type:
             source_cols_exprs.append(f'"{src}"::double precision')
        elif "boolean" in target_type:
             source_cols_exprs.append(f'"{src}"::boolean')
        elif "json" in target_type:
             source_cols_exprs.append(f'"{src}"::jsonb')
        else:
            source_cols_exprs.append(f'"{src}"::text')
            
        target_cols.append(f'"{tgt}"')
        
    if target_cols:
        target_cols_str = ", " + ", ".join(target_cols)
        source_expr_str = ", " + ", ".join(source_cols_exprs)
    else:
        target_cols_str = ""
        source_expr_str = ""
    
    sql = f"""
    INSERT INTO "{analytics_table}" (dataset_id{target_cols_str})
    SELECT '{dataset_id}'{source_expr_str}
    FROM "{source_table}";
    """
    try:
        with engine.connect() as conn:
            conn.execute(text(sql))
            conn.commit()
    except Exception as e:
        print(f"Materialization Failed for {source_table} -> {analytics_table}: {e}")
        raise e


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


def get_table_schema_dict(engine, table_name: str) -> dict:
    """Returns a mapping of column_name -> data_type for a table."""
    # Handle the fact that table_name might be quoted in queries but exists unquoted in info schema
    clean_table = table_name.replace('"', '')
    sql = """
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = :t
    """
    with engine.connect() as conn:
        res = conn.execute(text(sql), {"t": clean_table})
        # information_schema.columns returns some names that are useful for casting
        return {r[0]: r[1] for r in res.fetchall()}
