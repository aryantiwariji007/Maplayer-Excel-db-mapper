import os
import google.generativeai as genai
import json
from datetime import date, datetime
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=api_key)

class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        return super().default(obj)

POSTGRES_USER = os.getenv("POSTGRES_USER", "maplayer")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "maplayer_password")
POSTGRES_DB = os.getenv("POSTGRES_DB", "maplayer_db")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")

DATABASE_URL = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
engine = create_engine(DATABASE_URL)

def run_real_discovery():
    ld_id = "74081a2b-f65a-4e65-9513-b820d361d0b0"
    with engine.connect() as conn:
        ld = conn.execute(text("SELECT dataset_name, table_name FROM logical_datasets WHERE id = :id"), {"id": ld_id}).fetchone()
        if not ld:
            print("Logical dataset not found")
            return
        
        dataset_name, table_name = ld
        
        res = conn.execute(text(f'SELECT * FROM "{table_name}" LIMIT 5'))
        cols = list(res.keys())
        rows = [dict(zip(cols, row)) for row in res.fetchall()]
        
        print(f"Data ready. Dataset: {dataset_name}, Columns: {cols}")
        
    try:
        model = genai.GenerativeModel('gemini-3-flash-preview')
        
        prompt = f"""
        You are a world-class Business Intelligence and Data Analyst.
        Given the following dataset schema and sample data, suggest 5-8 highly relevant business metrics.
        
        Dataset Name: {dataset_name}
        
        Schema (Column Names and Types):
        {json.dumps(cols, indent=2)}
        
        Sample Data:
        {json.dumps(rows, indent=2, cls=DateTimeEncoder)}
        
        Instructions:
        1. Each metric must be a valid PostgreSQL SQL aggregate expression (e.g., 'SUM(revenue)', 'COUNT(DISTINCT user_id)', 'AVG(price)').
        2. Focus on metrics that provide business value (Growth, Efficiency, Volume, etc.).
        3. Ensure the SQL expressions only use columns that exist in the schema.
        
        Respond ONLY with a valid JSON array of objects. Each object must have:
        - "metric_name": A clear, professional name for the metric.
        - "sql_expression": The SQL aggregate expression.
        - "description": A brief explanation of what this metric represents.
        """
        
        print(f"Calling Gemini with model: gemini-3-flash-preview")
        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
        print(f"Response Received. Text: {response.text[:200]}...")
        print(f"Result Count: {len(json.loads(response.text))}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    run_real_discovery()
