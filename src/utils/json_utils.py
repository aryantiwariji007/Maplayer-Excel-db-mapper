import math

def sanitize_nans(obj):
    """Recursively replace NaN/Inf with None for JSON compliance."""
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    if isinstance(obj, dict):
        return {k: sanitize_nans(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_nans(i) for i in obj]
    return obj
