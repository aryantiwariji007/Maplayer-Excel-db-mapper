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

