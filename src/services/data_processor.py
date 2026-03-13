import pandas as pd
import io

def load_dataframe(file_bytes: bytes, filename: str, max_search_rows: int = 20) -> pd.DataFrame:
    """
    Loads a file into a pandas DataFrame, auto-detecting the true header row 
    by skipping initial metadata/title rows.
    """
    if filename.endswith(".csv"):
        df_raw = pd.read_csv(io.BytesIO(file_bytes), header=None, nrows=max_search_rows)
    elif filename.endswith(".xlsx") or filename.endswith(".xls"):
        df_raw = pd.read_excel(io.BytesIO(file_bytes), header=None, nrows=max_search_rows)
    else:
        raise ValueError("Unsupported file format. Please upload a CSV or Excel file.")

    best_row_idx = 0
    best_score = -1

    # Find the row with the most unique string values (likely the header)
    for idx, row in df_raw.iterrows():
        vals = row.dropna().astype(str).str.strip()
        vals = vals[vals != ""]
        
        if len(vals) == 0:
            continue
            
        unique_vals = set(vals)
        score = len(unique_vals)
        
        if score > best_score:
            best_score = score
            best_row_idx = idx

    # Load full dataset skipping the metadata rows
    if filename.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(file_bytes), skiprows=best_row_idx)
    else:
        df = pd.read_excel(io.BytesIO(file_bytes), skiprows=best_row_idx)

    # Clean headers: stringify and strip whitespace
    df.columns = [str(c).strip() for c in df.columns]
    
    return df

def parse_file(file_bytes: bytes, filename: str, preview_rows: int = 5):
    """Parses a CSV or Excel file and returns the column headers and a sample of rows."""
    try:
        df = load_dataframe(file_bytes, filename)
        headers = df.columns.tolist()
        
        # Take preview sample
        sample_df = df.head(preview_rows).fillna("")
        sample_data = sample_df.to_dict(orient="records")

        return {
            "headers": headers,
            "sample_data": sample_data,
            "total_rows": len(df)
        }
    except Exception as e:
        raise RuntimeError(f"Failed to parse file: {str(e)}")
