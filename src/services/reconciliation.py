"""
reconciliation.py
─────────────────────────────────────────────
Semantic reconciliation of source column names to logical schema fields,
using normalization, alias dictionaries, and fuzzy matching.
"""

import re
from rapidfuzz import fuzz

# Global static alias dictionary.
# In a full production system, this could be loaded from the database dynamically.
ALIASES = {
    # Tasks & Documents
    "work_task_number": [
        "work task number",
        "task number",
        "task id",
        "wtsr doc number",
        "document number",
        "doc num"
    ],
    # Assets & Equipment
    "asset_id": [
        "asset id",
        "equipment id",
        "machine id",
        "turbine desc",
        "turbine description"
    ],
    # Status & Dates
    "issue_date": [
        "issue date",
        "date issued",
        "creation date",
        "created at"
    ],
    # Physical metrics
    "temperature": [
        "temp",
        "mixing temperature",
        "temperature celsius",
        "temp c"
    ]
}

def normalize_column_name(col: str) -> str:
    """
    Normalizes a column name for comparison:
    WTSRDocNumber -> wtsr doc number
    task_number   -> task number
    """
    if not col:
         return ""
         
    # Replace underscores and dashes with spaces
    col = re.sub(r'[_\-]', ' ', col)
    # Split camelCase and PascalCase
    # This regex handles both lowercase->Uppercase and Uppercase->UppercaseLowercase 
    # (e.g., WTSRDocNumber -> WTSR Doc Number)
    col = re.sub(r'([a-z])([A-Z])', r'\1 \2', col)
    col = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', col)
    
    col = col.lower()
    # Remove extra whitespace
    col = " ".join(col.split())
    
    return col.strip()


def reconcile_columns(source_columns: list[str], expected_logical_columns: list[str]) -> dict:
    """
    Maps incoming source_columns to expected_logical_columns using:
    1. Perfect normalization match
    2. Alias Dictionary match
    3. Fuzzy string similarity if needed
    
    Returns: {"WTSRDocNumber": "work_task_number", ...}
    """
    mapping = {}
    
    normalized_expected = {normalize_column_name(c): c for c in expected_logical_columns}
    
    for s_col in source_columns:
        norm_s = normalize_column_name(s_col)
        
        # 1. Exact match on normalized names
        if norm_s in normalized_expected:
             mapping[s_col] = normalized_expected[norm_s]
             continue
             
        # 2. Check Alias Dictionary based on expected columns
        found_in_aliases = False
        for expected_col in expected_logical_columns:
            norm_expected = normalize_column_name(expected_col)
            # Check aliases registered for this logical key
            known_aliases = ALIASES.get(norm_expected, []) + ALIASES.get(expected_col, [])
            
            for alias in known_aliases:
                norm_alias = normalize_column_name(alias)
                # If the incoming column exactly matches a known alias phrasing
                if norm_s == norm_alias:
                    mapping[s_col] = expected_col
                    found_in_aliases = True
                    break
            
            if found_in_aliases:
                break
                
        if found_in_aliases:
             continue
             
        # 3. Fuzzy String Match as Final Fallback
        best_match = None
        best_score = 0
        
        # Compare against expected raw names and their aliases
        for expected_col in expected_logical_columns:
             norm_expected = normalize_column_name(expected_col)
             
             # Score against the root logical name
             score = fuzz.token_sort_ratio(norm_s, norm_expected)
             
             # Score against its known aliases
             known_aliases = ALIASES.get(norm_expected, []) + ALIASES.get(expected_col, [])
             for alias in known_aliases:
                 alias_score = fuzz.token_sort_ratio(norm_s, normalize_column_name(alias))
                 score = max(score, alias_score)
                 
             if score > best_score:
                 best_score = score
                 best_match = expected_col
                 
        # Apply a rigorous threshold for fuzzy fallback
        if best_match and best_score > 75:
            mapping[s_col] = best_match

    return mapping
