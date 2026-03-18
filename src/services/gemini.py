import os
import google.generativeai as genai
import json

from datetime import date, datetime
from dotenv import load_dotenv

load_dotenv()

class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        return super().default(obj)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

def map_columns_with_ai(source_columns, sample_data, target_columns, schema_description):
    if not GEMINI_API_KEY:
        print("Gemini API key missing, skipping AI mapper.")
        return []
    
    try:
        model = genai.GenerativeModel('gemini-3-flash-preview')
        
        # Support both strict structural objects and plain string lists for logical schemas
        is_string_list = all(isinstance(c, str) for c in target_columns)
        
        if is_string_list:
            formatted_targets = json.dumps([{"key": c} for c in target_columns], indent=2)
        else:
            formatted_targets = json.dumps([{ 'key': getattr(c, 'key', str(c)), 'label': getattr(c, 'label', ''), 'description': getattr(c, 'description', '') } for c in target_columns], indent=2)

        prompt = f"""
        You are an expert data migration assistant. Your task is to map source columns from an uploaded file to a specific target schema.
        
        Target Schema Description: {schema_description or "A dynamic analytics schema"}
        
        Target Schema Fields (keys you can map to):
        {formatted_targets}
        
        Source Columns To Map: {json.dumps(source_columns)}
        
        Sample Data from Source File (first few rows):
        {json.dumps(sample_data, indent=2, cls=DateTimeEncoder)}
        
        Please map EACH source column to exactly ONE target key from the schema.
        Respond ONLY with a valid JSON array of objects. Each object must have:
        1. "source": the exact source column name
        2. "target": the chosen target schema key (must exist in schema) or null if no appropriate map exists
        3. "confidence": a number from 0 to 1 indicating your confidence
        4. "reason": a brief string explaining why
        
        JSON response format:
        [
            {{ "source": "...", "target": "...", "confidence": 0.95, "reason": "..." }}
        ]
        """
        
        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
        response_text = response.text
        
        mappings = json.loads(response_text)
        return mappings
    except Exception as e:
        print(f"Gemini API Error: {e}")
        return []


def choose_best_schema_with_ai(
    source_columns: list,
    sample_data: list,
    static_candidates: list,
    dynamic_candidates: list,
) -> dict | None:
    """
    Ask Gemini AI to choose the best matching schema from all available candidates.
    
    Returns a dict:
    {
        "schema_type": "static" | "dynamic" | "none",
        "schema_id": "...",
        "schema_name": "...",
        "confidence": 0.0-1.0,
        "column_mapping": {"source_col": "target_col", ...},
        "reason": "..."
    }
    """
    if not GEMINI_API_KEY:
        return None
    
    if not static_candidates and not dynamic_candidates:
        return None

    try:
        model = genai.GenerativeModel('gemini-3-flash-preview')

        prompt = f"""
You are a world-class data integration engineer. You are matching an uploaded Excel/CSV file to the most appropriate target schema.

**Source File Columns:**
{json.dumps(source_columns, indent=2)}

**Sample Data (first rows of the file):**
{json.dumps(sample_data[:5], indent=2, cls=DateTimeEncoder)}

**Available Static Schemas (fixed, production DB contracts):**
{json.dumps([{"id": s["id"], "name": s["name"], "description": s["description"], "fields": s["target_keys"]} for s in static_candidates], indent=2)}

**Available Dynamic Schemas (AI-discovered schema groups):**
{json.dumps([{"id": d["id"], "name": d["name"], "description": d["description"], "known_columns": d["target_keys"]} for d in dynamic_candidates], indent=2)}

**Your Task:**
1. Determine which schema (static or dynamic) this file MOST LIKELY belongs to, based on columns and data.
2. Prefer static schemas if the file is clearly following a strict contract.
3. Prefer dynamic schemas if the file is a variation of an already-seen dataset type.
4. If no schema matches, return schema_type "none".
5. For the winning schema, provide a complete column_mapping of source columns to target schema keys.
   - Only map source columns where you are confident (confidence > 0.6).
   - For dynamic schemas with no existing columns, map each source column to itself (identity mapping).

Respond ONLY with valid JSON:
{{
    "schema_type": "static" | "dynamic" | "none",
    "schema_id": "<id of the chosen schema>",
    "schema_name": "<name of the chosen schema>",
    "confidence": 0.85,
    "column_mapping": {{"source_col_1": "target_col_a", "source_col_2": "target_col_b"}},
    "reason": "Brief explanation of why this schema was chosen"
}}
"""
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"}
        )
        result = json.loads(response.text)
        print(f"DEBUG: Gemini Schema Resolution: type={result.get('schema_type')}, schema={result.get('schema_name')}, confidence={result.get('confidence')}")
        return result
    except Exception as e:
        print(f"Gemini choose_best_schema_with_ai Error: {e}")
        return None


def discover_metrics_with_ai(dataset_name, columns, sample_data):
    """
    Suggest business metrics based on a dataset's columns and sample data.
    Returns a list of suggested metrics with SQL expressions.
    """
    if not GEMINI_API_KEY:
        return []
    
    try:
        model = genai.GenerativeModel('gemini-3-flash-preview')
        
        prompt = f"""
        You are a world-class Business Intelligence and Data Analyst.
        Given the following dataset schema and sample data, suggest 5-8 highly relevant business metrics.
        
        Dataset Name: {dataset_name}
        
        Schema (Column Names and Types):
        {json.dumps(columns, indent=2)}
        
        Sample Data:
        {json.dumps(sample_data, indent=2, cls=DateTimeEncoder)}
        
        Instructions:
        1. Each metric must be a valid PostgreSQL SQL aggregate expression (e.g., 'SUM(revenue)', 'COUNT(DISTINCT user_id)', 'AVG(price)').
        2. Focus on metrics that provide business value (Growth, Efficiency, Volume, etc.).
        3. Ensure the SQL expressions only use columns that exist in the schema.
        
        Respond ONLY with a valid JSON array of objects. Each object must have:
        - "metric_name": A clear, professional name for the metric.
        - "sql_expression": The SQL aggregate expression.
        - "description": A brief explanation of what this metric represents.
        
        Example Output:
        [
            {{ "metric_name": "Total Revenue", "sql_expression": "SUM(revenue)", "description": "Total sum of all transaction revenue." }}
        ]
        """
        
        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
        print(f"Gemini Discovery Response: {response.text}")
        return json.loads(response.text)
    except Exception as e:
        print(f"Gemini Metric Discovery Error: {e}")
        # Log the full response if possible
        try:
            if 'response' in locals():
                print(f"Full response object: {response}")
        except:
            pass
        return []

