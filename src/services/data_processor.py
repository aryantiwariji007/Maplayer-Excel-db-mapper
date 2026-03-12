import pandas as pd
import io

def parse_file(file_bytes: bytes, filename: str, preview_rows: int = 5):
    """Parses a CSV or Excel file and returns the column headers and a sample of rows."""
    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(file_bytes))
        elif filename.endswith(".xlsx") or filename.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(file_bytes))
        else:
            raise ValueError("Unsupported file format. Please upload a CSV or Excel file.")

        # Clean column names
        df.columns = [str(c).strip() for c in df.columns]
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
