"""
schema_inference.py
─────────────────────────────────────────────
Infers a typed schema from a loaded pandas DataFrame.
Produces Dataset + DatasetColumn metadata ready for DB insertion.
"""

import re
import uuid
import pandas as pd

# ── Type mapping ─────────────────────────────────────────────────────────────
_TYPE_ALIASES = {
    "text": "string",
    "string": "string",
    "email": "string",
    "phone": "string",
    "url": "string",
    "number": "float",
    "date": "timestamp",
    "boolean": "boolean",
}

_PG_TYPE_MAP = {
    "string":    "TEXT",
    "integer":   "BIGINT",
    "float":     "DOUBLE PRECISION",
    "boolean":   "BOOLEAN",
    "timestamp": "TIMESTAMP",
    "json":      "JSONB",
}


def normalize_column_name(col: str) -> str:
    """
    Convert a raw column name into a safe Postgres identifier:
    - lowercase
    - strip units in parentheses/brackets e.g. "Temp (°C)" → "temp"
    - replace non-alphanumeric chars with underscores
    - collapse repeated underscores
    - strip leading/trailing underscores
    """
    col = str(col).strip()
    # Remove content in parentheses/brackets (units, etc.)
    col = re.sub(r"[\(\[°][^)\]]*[\)\]]?", "", col)
    col = col.lower()
    col = re.sub(r"[^a-z0-9]+", "_", col)
    col = re.sub(r"_+", "_", col).strip("_")
    if not col:
        col = "col"
    # Prefix if starts with digit
    if col[0].isdigit():
        col = "c_" + col
    return col


def infer_column_type(series: pd.Series) -> str:
    """Infer one of: string | integer | float | boolean | timestamp | json."""
    s = series.dropna()
    if s.empty:
        return "string"

    s_str = s.astype(str).str.strip()

    # Integer
    try:
        numeric = pd.to_numeric(s, errors="raise")
        if (numeric == numeric.astype("int64")).all():
            return "integer"
        return "float"
    except (ValueError, TypeError):
        pass

    # Float (with commas / spaces)
    try:
        pd.to_numeric(s_str.str.replace(",", "").str.replace(" ", ""), errors="raise")
        return "float"
    except (ValueError, TypeError):
        pass

    # Boolean (Explicit strings only)
    bool_vals = {"true", "false", "yes", "no", "y", "n"}
    if s_str.str.lower().isin(bool_vals).mean() > 0.8:
        return "boolean"

    # Timestamp
    try:
        parsed = pd.to_datetime(s_str, errors="coerce", format="mixed")
        if parsed.notna().mean() > 0.8:
            return "timestamp"
    except Exception:
        pass

    # JSON-like
    if s_str.str.startswith("{").mean() > 0.5 or s_str.str.startswith("[").mean() > 0.5:
        return "json"

    return "string"


def pg_type(inferred: str) -> str:
    return _PG_TYPE_MAP.get(inferred, "TEXT")


def infer_schema(df: pd.DataFrame, product_id: str, file_name: str) -> dict:
    """
    Analyse a DataFrame and return schema metadata dict with:
      - dataset: dict (id, product_id, file_name, table_name, row_count)
      - columns: list[dict] (column_name, normalized_name, data_type, pg_type)
    """
    dataset_id = str(uuid.uuid4())
    table_name = f"upload_{dataset_id.replace('-', '_')}"

    columns = []
    used_names: set[str] = set()

    for raw_col in df.columns:
        base_norm = normalize_column_name(raw_col)
        # Postgres limits identifiers to 63 bytes. We truncate to 55 to leave room for the deduplication suffix.
        base_norm = base_norm[:55]
        
        norm = base_norm
        counter = 1
        while norm in used_names:
            norm = f"{base_norm}_{counter}"
            counter += 1
        
        used_names.add(norm)

        dtype = infer_column_type(df[raw_col])
        columns.append({
            "column_name": str(raw_col).strip(),
            "normalized_name": norm,
            "data_type": dtype,
            "pg_type": pg_type(dtype),
        })

    return {
        "dataset": {
            "id": dataset_id,
            "product_id": product_id,
            "file_name": file_name,
            "table_name": table_name,
            "row_count": len(df),
        },
        "columns": columns,
    }
