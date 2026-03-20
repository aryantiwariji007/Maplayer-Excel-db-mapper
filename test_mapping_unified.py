import requests
import json

base_url = "http://localhost:8001"

print("--- Testing Unified schemas ---")
all_schemas_resp = requests.get(f"{base_url}/ingest/all-schemas?product_id=default")
try:
    schemas = all_schemas_resp.json()
    print(f"Found {len(schemas)} schemas")
    for s in schemas:
        print(f" - {s['schema_name']} ({s['schema_type']}) - {len(s['columns'])} cols")
except Exception as e:
    print("Failed to get all-schemas:", all_schemas_resp.text)
    

print("\n--- Uploading test file ---")
filepath = "testing/test-contacts.csv"
import os
os.makedirs("testing", exist_ok=True)
if not os.path.exists(filepath):
    with open(filepath, "w") as f:
        f.write("name,email,phone\nAlice,alice@example.com,12345\nBob,bob@example.com,67890\n")

with open(filepath, "rb") as f:
    files = {"file": f}
    data = {"product_id": "default", "auto_map": "false"}
    response = requests.post(f"{base_url}/ingest/upload", files=files, data=data)

dataset_id = response.json().get("dataset_id")
print(f"Uploaded dataset {dataset_id}")

print("\n--- Auto mapping ---")
map_data = {
    "dataset_id": dataset_id,
    "auto_map": "true"
}
map_resp = requests.post(f"{base_url}/ingest/dataset/map", data=map_data)
map_json = map_resp.json()
print("Map response:")
print(json.dumps(map_json, indent=2))

logical_dataset_id = map_json.get("logical_dataset_id")
schema_name = map_json.get("detected_schema")

print(f"\n--- Testing confirm correction for {schema_name} ---")
correct_data = {
    "product_id": "default",
    "schema_name": schema_name,
    "source_column": "name",
    "correct_target_key": "contact_name"
}
confirm_resp = requests.post(f"{base_url}/map/confirm", json=correct_data)
if confirm_resp.status_code == 200:
    print("Confirm correction succeeded!", confirm_resp.json())
else:
    print("Confirm failed", confirm_resp.status_code, confirm_resp.text)
