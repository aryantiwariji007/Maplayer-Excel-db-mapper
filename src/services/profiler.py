import re
import pandas as pd

def infer_data_type(series: pd.Series) -> str:
    """Infers the mostly likely data type of a Pandas series."""
    # Drop NAs for type inference
    s = series.dropna()
    if s.empty:
        return "text"
        
    s_str = s.astype(str).str.strip()
    
    # 1. Boolean check
    bool_vals = {"true", "false", "yes", "no", "1", "0", "y", "n"}
    if s_str.str.lower().isin(bool_vals).mean() > 0.8:
        return "boolean"
        
    # 2. Email check
    email_regex = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
    if s_str.str.contains(email_regex, regex=True).mean() > 0.8:
        return "email"
        
    # 3. Phone check (basic: starts with +, contains digits, hyphens, parentheses, length > 8)
    phone_regex = r'^\+?[\d\s\-\(\)]{8,20}$'
    # Need to be somewhat strict to avoid matching short numbers
    if s_str.str.contains(phone_regex, regex=True).mean() > 0.8:
        # verify it has at least 7 digits
        digit_counts = s_str.str.count(r'\d')
        if (digit_counts >= 7).mean() > 0.8:
            return "phone"
        
    # 4. URL check
    url_regex = r'^https?://[^\s/$.?#].[^\s]*$'
    if s_str.str.contains(url_regex, regex=True).mean() > 0.8:
        return "url"
        
    # 5. Number check
    try:
        pd.to_numeric(s)
        return "number"
    except (ValueError, TypeError):
        pass
        
    # 6. Date check
    # Try parsing date with error coercion
    dates = pd.to_datetime(s_str, errors='coerce', format='mixed')
    if dates.notna().mean() > 0.8:
        return "date"
        
    # Fallback
    return "string"

def profile_column(header: str, series: pd.Series) -> dict:
    """Profiles a column to determine its type and sample values."""
    inferred_type = infer_data_type(series)
    
    # get a few non-empty examples
    examples = series.dropna().astype(str).unique()[:3].tolist()
    
    return {
        "header": header,
        "inferred_data_type": inferred_type,
        "examples": examples
    }
