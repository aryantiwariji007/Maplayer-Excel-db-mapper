import requests

url = "http://localhost:8000/ingest/upload-bulk"

with open("testing/test-contacts.csv", "rb") as f1, open("testing/test-contacts.csv", "rb") as f2:
    files = [("files", ("test1.csv", f1)), ("files", ("test2.csv", f2))]
    data = {"product_id": "default", "auto_map": "true"}
    response = requests.post(url, files=files, data=data)

print(response.status_code)
print(response.text)
