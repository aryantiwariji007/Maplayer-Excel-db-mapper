"""
materialization.py
─────────────────────────────────────────────
Unified table materialization layer.
Handles writing dataset rows into both:
  - Static schema tables:  mapped_<schema_id> 
  - Dynamic logical tables: analytics_<ld_id>
"""

from sqlalchemy.engine import Engine
from sqlalchemy import text


def ensure_static_table(engine: Engine, table_name: str, column_mapping: dict, source_columns: list[dict]) -> None:
    """
    Create or evolve a static-schema materialized table.
    table_name: mapped_<schema_id>
    column_mapping: {source_col -> target_schema_key}
    source_columns: [{normalized_name, pg_type}]
    """
    from .dataset_store import get_table_columns, add_columns_to_analytics_table, create_analytics_table
    try:
        existing_cols = get_table_columns(engine, table_name)
        type_map = {c["normalized_name"]: c["pg_type"] for c in source_columns}
        new_cols = {
            tgt: type_map.get(src, "TEXT")
            for src, tgt in column_mapping.items()
            if tgt not in existing_cols
        }
        if new_cols:
            add_columns_to_analytics_table(engine, table_name, new_cols)
    except Exception:
        # Table doesn't exist — create it
        create_analytics_table(engine, table_name, column_mapping, source_columns)


def ensure_dynamic_table(engine: Engine, table_name: str, column_mapping: dict, source_columns: list[dict]) -> None:
    """
    Create or evolve a dynamic-schema (logical dataset) analytics table.
    """
    ensure_static_table(engine, table_name, column_mapping, source_columns)


def append_rows(engine: Engine, analytics_table: str, source_table: str, column_mapping: dict, dataset_id: str) -> None:
    """
    INSERT rows from source_table into analytics_table using the column mapping.
    Handles type casting automatically.
    """
    from .dataset_store import get_table_schema_dict

    if not column_mapping:
        # Nothing to insert
        return

    target_types = get_table_schema_dict(engine, analytics_table)
    source_types = get_table_schema_dict(engine, source_table)

    source_exprs = []
    target_cols = []

    for src, tgt in column_mapping.items():
        target_type = target_types.get(tgt, "text").lower()
        source_type = source_types.get(src, "text").lower()

        if "timestamp" in target_type:
            source_exprs.append(f'(CASE WHEN "{src}"::text ~ \'^[0-9]{{4}}\' THEN "{src}"::timestamp ELSE NULL END)')
        elif "date" in target_type:
            source_exprs.append(f'(CASE WHEN "{src}"::text ~ \'^[0-9]{{4}}\' THEN "{src}"::date ELSE NULL END)')
        elif "time" in target_type:
            source_exprs.append(f'(CASE WHEN "{src}"::text ~ \'^[0-9]{{2}}\' THEN "{src}"::time ELSE NULL END)')
        elif "bigint" in target_type or "integer" in target_type:
            if "timestamp" in source_type or "date" in source_type:
                source_exprs.append(f'EXTRACT(EPOCH FROM "{src}")::bigint')
            else:
                source_exprs.append(f'(CASE WHEN "{src}"::text ~ \'^-?[0-9]+\' THEN "{src}"::bigint ELSE NULL END)')
        elif "double" in target_type or "numeric" in target_type or "float" in target_type:
            source_exprs.append(f'(CASE WHEN "{src}"::text ~ \'^-?[0-9]\' THEN "{src}"::double precision ELSE NULL END)')
        elif "boolean" in target_type:
            source_exprs.append(f'(CASE WHEN lower("{src}"::text) IN (\'true\',\'yes\',\'1\') THEN true WHEN lower("{src}"::text) IN (\'false\',\'no\',\'0\') THEN false ELSE NULL END)')
        elif "json" in target_type:
             source_exprs.append(f'(CASE WHEN "{src}"::text ~ \'^[\\{{\\[]\' THEN "{src}"::jsonb ELSE NULL END)')
        else:
            source_exprs.append(f'"{src}"::text')

        target_cols.append(f'"{tgt}"')

    if not target_cols:
        return

    target_str = ", " + ", ".join(target_cols)
    expr_str = ", " + ", ".join(source_exprs)

    delete_sql = f'DELETE FROM "{analytics_table}" WHERE dataset_id = :did'
    insert_sql = f"""
    INSERT INTO "{analytics_table}" (dataset_id{target_str})
    SELECT '{dataset_id}'{expr_str}
    FROM "{source_table}";
    """
    try:
        with engine.begin() as conn:
            conn.execute(text(delete_sql), {"did": dataset_id})
            conn.execute(text(insert_sql))
        print(f"DEBUG: Materialized {source_table} -> {analytics_table} ({len(target_cols)} columns)")
    except Exception as e:
        print(f"ERROR: Materialization failed {source_table} -> {analytics_table}: {e}")
        raise
