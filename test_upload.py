import requests

url = "http://localhost:8000/ingest/upload"
filepath = "testing/test-contacts.csv"

# Let's create a temp file if it doesn't exist just to test
import os
if not os.path.exists(filepath):
    os.makedirs("testing", exist_ok=True)
    with open(filepath, "w") as f:
        f.write("name,email\nJohn,john@example.com\n")

with open(filepath, "rb") as f:
    files = {"file": f}
    data = {"product_id": "default", "auto_map": "true"}
    response = requests.post(url, files=files, data=data)

print(response.status_code)
print(response.text)
