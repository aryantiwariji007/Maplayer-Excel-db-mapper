import os
import google.generativeai as genai
import json
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=api_key)

def discover_metrics_test():
    dataset_name = "Asset Management"
    columns = ["id", "asset_name", "category", "purchase_price", "purchase_date", "current_value", "location"]
    sample_data = [
        {"id": 1, "asset_name": "Macbook Pro", "category": "Electronics", "purchase_price": 2000, "purchase_date": "2023-01-10", "current_value": 1500, "location": "New York"},
        {"id": 2, "asset_name": "Office Chair", "category": "Furniture", "purchase_price": 500, "purchase_date": "2023-02-15", "current_value": 400, "location": "London"}
    ]
    
    try:
        model = genai.GenerativeModel('gemini-3-flash-preview')
        
        prompt = f"""
        You are a world-class Business Intelligence and Data Analyst.
        Given the following dataset schema and sample data, suggest 5-8 highly relevant business metrics.
        
        Dataset Name: {dataset_name}
        
        Schema (Column Names and Types):
        {json.dumps(columns, indent=2)}
        
        Sample Data:
        {json.dumps(sample_data, indent=2)}
        
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
        
        print(f"Calling Gemini with model: gemini-3-flash-preview")
        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
        print(f"Response received. Text length: {len(response.text)}")
        print(f"Response text: {response.text}")
        return json.loads(response.text)
    except Exception as e:
        print(f"Error: {e}")
        return []

if __name__ == "__main__":
    res = discover_metrics_test()
    print(f"Result: {json.dumps(res, indent=2)}")
