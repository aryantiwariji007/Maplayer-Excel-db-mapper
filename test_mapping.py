import requests
import json

base_url = "http://localhost:8000"

# 1. Upload a file to get a dataset_id
upload_url = f"{base_url}/ingest/upload"
filepath = "testing/test-contacts.csv"

# Pre-prepare the file if needed
import os
os.makedirs("testing", exist_ok=True)
if not os.path.exists(filepath):
    with open(filepath, "w") as f:
        f.write("name,email,phone\nAlice,alice@example.com,12345\nBob,bob@example.com,67890\n")

print(f"--- Step 1: Uploading {filepath} ---")
with open(filepath, "rb") as f:
    files = {"file": f}
    data = {"product_id": "default", "auto_map": "false"} # Use false here so we can map it manually next
    response = requests.post(upload_url, files=files, data=data)

if response.status_code != 200:
    print(f"Upload failed: {response.text}")
    exit(1)

dataset_id = response.json().get("dataset_id")
print(f"Upload successful. dataset_id: {dataset_id}")

# 2. Map it using /ingest/dataset/map with auto_map=True and NO logical_dataset_id
map_url = f"{base_url}/ingest/dataset/map"
print(f"\n--- Step 2: Mapping {dataset_id} via /dataset/map (auto_map=True) ---")
map_data = {
    "dataset_id": dataset_id,
    "auto_map": "true"
    # logical_dataset_id is OMITTED
}

response = requests.post(map_url, data=map_data)

print(f"Status Code: {response.status_code}")
try:
    print(json.dumps(response.json(), indent=2))
except:
    print(response.text)
