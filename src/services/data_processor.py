import pandas as pd
import io

def load_dataframe(file_bytes: bytes, filename: str, max_search_rows: int = 50) -> pd.DataFrame:
    """
    Loads a file into a pandas DataFrame, auto-detecting the true header row 
    by skipping initial metadata/title rows.
    """
    if filename.endswith(".csv"):
        df_raw = pd.read_csv(io.BytesIO(file_bytes), header=None, nrows=max_search_rows)
    elif filename.endswith(".xlsx") or filename.endswith(".xls"):
        # For Excel, we should detect the sheet with the most data if multiple exist
        try:
            xl = pd.ExcelFile(io.BytesIO(file_bytes), engine='openpyxl')
        except:
            xl = pd.ExcelFile(io.BytesIO(file_bytes))
            
        sheet_best = xl.sheet_names[0]
        max_pop = 0

        # Heuristic: Pick sheet with most data if first sheet is suspicious
        for sheet in xl.sheet_names:
            try:
                temp_df = xl.parse(sheet, header=None, nrows=30)
                pop = temp_df.count().sum()
                if pop > max_pop:
                    max_pop = pop
                    sheet_best = sheet
            except:
                continue
        
        print(f"DEBUG: Selected sheet '{sheet_best}' for {filename} (Population sample: {max_pop})")
        df_raw = xl.parse(sheet_best, header=None, nrows=max_search_rows)
    else:
        raise ValueError("Unsupported file format. Please upload a CSV or Excel file.")

    print(f"DEBUG: Auto-detecting header for {filename} (deep scan)...")
    best_row_idx = 0
    best_score = -1000.0
    
    # We'll use an early-exit strategy: the first row that is 100% text and reasonably wide
    # is almost certainly the header.
    for idx, row in df_raw.iterrows():
        populated = row.dropna()
        if len(populated) == 0:
            continue
            
        vals = populated.astype(str).str.strip()
        vals = vals[vals != ""]
        if len(vals) == 0:
            continue
            
        text_cells = 0
        numeric_cells = 0
        for val in vals:
            # Clean for numeric check (commas, spaces, currency)
            clean_val = val.replace(",", "").replace(" ", "").replace("$", "").replace("%", "")
            try:
                # If it can be a number, it's likely data
                if clean_val and (clean_val[0].isdigit() or (len(clean_val)>1 and clean_val[0] in ('-','.') and clean_val[1].isdigit())):
                    float(clean_val)
                    numeric_cells += 1
                else:
                    raise ValueError()
            except ValueError:
                val_lower = val.lower()
                if val_lower not in ("true", "false", "nan", "nat", "none", "null"):
                    text_cells += 1
        
        # Early exit: 100% text and at least 3 columns populated? 
        # This is almost guaranteed to be the header row.
        if numeric_cells == 0 and text_cells >= 3:
            print(f"DEBUG: Found perfect header candidate at Row {idx} (Text columns: {text_cells}). Stopping early.")
            best_row_idx = idx
            best_score = 999
            break
            
        # Otherwise, calculate a weighted score
        unique_text_count = len(set([v for v in vals if v.lower() not in ("true", "false", "nan", "nat")]))
        score = unique_text_count - (numeric_cells * 20) # Heavy penalty
        
        print(f"DEBUG: Row {idx} -> Text: {text_cells}, Numeric: {numeric_cells}, Unique: {unique_text_count}, Final Score: {score}")

        if score > best_score:
            best_score = score
            best_row_idx = idx

    print(f"DEBUG: Final Decision -> Row Index {best_row_idx} (Score: {best_score})")

    # Load full dataset skipping the metadata rows
    if filename.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(file_bytes), skiprows=best_row_idx)
    else:
        # Re-parse the selected sheet
        try:
            df = xl.parse(sheet_best, skiprows=best_row_idx)
        except:
            # Fallback to broad read if xl object failed
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
