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


def generate_narrative_with_ai(
    dataset_name: str,
    column_profiles: list,
    anomaly_summary: dict,
    trend_summary: list,
) -> dict:
    """
    Generate a 3-bullet executive narrative summary from pre-computed statistics only.
    Sends NO raw data to Gemini — only computed stats, counts, and summaries.

    Returns:
        {"narrative": "...", "bullet_points": ["...", "...", "..."]}
    """
    if not GEMINI_API_KEY:
        return {"narrative": "", "bullet_points": []}

    try:
        model = genai.GenerativeModel('gemini-3-flash-preview')

        prompt = f"""
You are a senior data analyst generating an executive summary from pre-computed dataset statistics.
You are analyzing COMPUTED STATISTICS ONLY — you are not receiving any raw customer data.

Dataset Name: {dataset_name}

Column Statistics Summary:
{json.dumps(column_profiles, indent=2, cls=DateTimeEncoder)}

Anomaly Detection Summary:
- Total flagged values: {anomaly_summary.get("total", 0)}
- High severity: {anomaly_summary.get("high", 0)}
- Medium severity: {anomaly_summary.get("medium", 0)}
- Low severity: {anomaly_summary.get("low", 0)}
- Most affected columns: {json.dumps(anomaly_summary.get("top_columns", []))}

Trend Analysis Summary:
{json.dumps(trend_summary, indent=2) if trend_summary else "No time-series data detected."}

Instructions:
1. Write EXACTLY 3 bullet points as an executive summary for a business stakeholder.
2. Be specific — reference actual numbers from the statistics (means, null percentages, anomaly counts, trend directions).
3. Keep each bullet point to 1-2 sentences.
4. Write in plain English, avoiding technical jargon like "z-score" or "IQR".
5. Focus on: (1) data quality/completeness, (2) notable patterns or anomalies, (3) trends if available.

Respond ONLY with valid JSON:
{{
    "bullet_points": [
        "First bullet point...",
        "Second bullet point...",
        "Third bullet point..."
    ]
}}
"""
        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
        result = json.loads(response.text)
        bullet_points = result.get("bullet_points", [])
        narrative = "\n".join(f"• {b}" for b in bullet_points)
        return {"narrative": narrative, "bullet_points": bullet_points}
    except Exception as e:
        print(f"Gemini Narrative Generation Error: {e}")
        return {"narrative": "", "bullet_points": []}


def suggest_comparison_config_with_ai(schema_name: str, columns: list) -> dict:
    """
    Given schema name and column definitions, suggest GROUP BY keys, VALUE columns, and aggregation.
    columns: [{"key": "price", "data_type": "numeric"}, ...]
    Returns: {"group_by": [...], "value_columns": [...], "aggregation": "min"|"max"|"avg"|"first", "rationale": "..."}
    """
    if not GEMINI_API_KEY:
        return {}

    try:
        model = genai.GenerativeModel('gemini-3-flash-preview')

        prompt = f"""
You are an expert data analyst. Given the schema name and column definitions below, suggest the best configuration for a vendor comparison pivot table.

Schema Name: {schema_name}

Columns (with types where available):
{json.dumps(columns, indent=2)}

Your task:
1. Choose 1-3 columns that best serve as GROUP BY keys (row identifiers that uniquely identify a line item, e.g. description, ref_no, item code).
2. Choose 1-2 columns that are numeric values to compare across vendors (e.g. price, rate, cost, quantity).
3. Choose the best aggregation: "min" if comparing prices/costs (lower is better), "max" if comparing performance metrics (higher is better), "avg" for averages, "first" for text/categorical.
4. Explain your reasoning briefly.

Respond ONLY with valid JSON:
{{
    "group_by": ["description", "ref_no"],
    "value_columns": ["price", "currency"],
    "aggregation": "min",
    "rationale": "price is numeric so minimum finds cheapest vendor; description+ref_no uniquely identify line items"
}}
"""
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"}
        )
        result = json.loads(response.text)
        return result
    except Exception as e:
        print(f"Gemini suggest_comparison_config_with_ai Error: {e}")
        return {}


def generate_comparison_narrative_with_ai(schema_name: str, comparison_summary: dict) -> dict:
    """
    Generate an AI narrative from comparison stats (NO raw data, just aggregated summaries).
    comparison_summary contains: vendor_count, value_columns, vendor_stats (min/max/avg per vendor per col),
    best_vendor per col, coverage_stats.
    Returns: {"headline": "...", "bullets": ["...", "...", "..."], "recommendation": "..."}
    """
    if not GEMINI_API_KEY:
        return {}

    try:
        model = genai.GenerativeModel('gemini-3-flash-preview')

        prompt = f"""
You are a senior procurement analyst generating an executive summary from pre-computed vendor comparison statistics.
You are analyzing COMPUTED STATISTICS ONLY — no raw customer data.

Schema / Dataset: {schema_name}

Comparison Summary:
{json.dumps(comparison_summary, indent=2, cls=DateTimeEncoder)}

Instructions:
1. Write a 1-line headline summarizing the overall comparison finding.
2. Write exactly 3 bullet points covering key findings (reference actual numbers from vendor_stats).
3. Write a clear recommendation: which vendor to choose and why.
4. Be specific — mention vendor names, price differences, coverage gaps where relevant.

Respond ONLY with valid JSON:
{{
    "headline": "1-line summary",
    "bullets": ["Finding 1...", "Finding 2...", "Finding 3..."],
    "recommendation": "Which vendor to choose and why"
}}
"""
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"}
        )
        result = json.loads(response.text)
        return result
    except Exception as e:
        print(f"Gemini generate_comparison_narrative_with_ai Error: {e}")
        return {}


def discover_metrics_with_ai(dataset_name, columns, sample_data):
    """
    Suggest business metrics based on a dataset's columns and sample data.
    Returns a list of suggested metrics with SQL expressions.
    Raises on failure so the caller can surface a proper HTTP error.
    """
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured on the server.")

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

