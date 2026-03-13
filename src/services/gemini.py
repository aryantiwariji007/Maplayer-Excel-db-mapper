import os
import google.generativeai as genai
import json

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

def map_columns_with_ai(source_columns, sample_data, target_columns, schema_description):
    if not GEMINI_API_KEY:
        print("Gemini API key missing, skipping AI mapper.")
        return []
    
    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        prompt = f"""
        You are an expert data migration assistant. Your task is to map source columns from an uploaded file to a specific target schema.
        
        Target Schema Description: {schema_description or "A strict data schema"}
        
        Target Schema Fields:
        {json.dumps([{ 'key': c.key, 'label': c.label, 'description': c.description, 'examples': c.examples } for c in target_columns], indent=2)}
        
        Source Columns To Map: {json.dumps(source_columns)}
        
        Sample Data from Source File (first few rows):
        {json.dumps(sample_data, indent=2)}
        
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
