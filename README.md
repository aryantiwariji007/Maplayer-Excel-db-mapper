# MapLayer

MapLayer is a production-ready REST API service designed to be embedded across multiple SaaS products. It acts as an AI-powered tabular data parsing and column-mapping layer utilizing the Gemini API.

When users upload CSV or Excel files with arbitrary column structures, MapLayer semantically matches those source columns to a strict target database schema. It handles transformations and learns from user corrections over time using a SQLite-backed schema registry and correction memory storage.

## Tech Stack
- Node.js + TypeScript
- Express.js
- Gemini API (via `@google/genai`)
- SQLite (`better-sqlite3`)
- `multer` for file uploads
- `xlsx` for parsing
- `zod` for validation

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file in the root directory:
   ```env
   PORT=3000
   GEMINI_API_KEY=your_gemini_api_key_here
   DB_PATH=./maplayer.db
   ```

3. **Start the Server**
   ```bash
   npm run dev
   ```

## API Reference

### Register a Target Schema
```bash
curl -X POST http://localhost:3000/schemas \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "crm-v2",
    "schema_name": "contact_list",
    "description": "Contact import schema",
    "columns": [
      {
        "key": "first_name",
        "label": "First Name",
        "description": "The contact given name",
        "data_type": "string",
        "required": true
      },
      {
        "key": "email",
        "label": "Email Address",
        "description": "Main contact email",
        "data_type": "email",
        "required": true
      }
    ]
  }'
```

### Call /map with a File
Map an uploaded CSV/Excel file against a registered schema:
```bash
curl -X POST http://localhost:3000/map \
  -F "file=@/path/to/your/upload.csv" \
  -F "product_id=crm-v2" \
  -F "schema_name=contact_list" \
  -F 'options={"confidence_threshold": 0.8}'
```

### Review Flow & Confidence
When `/map` is called, MapLayer uses the AI to match source columns to the `target_key` with a `confidence` score (0.0 to 1.0). 
If the confidence is below the threshold, or if there is an `ambiguity` (multiple logical matches), the result `status` is marked as `needs_review`. The UI should then prompt the user to manually select the correct key.

### Confirm Mappings
Once the user reviews, the UI sends the confirmed mappings:
```bash
curl -X POST http://localhost:3000/map/confirm \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "job-uuid",
    "product_id": "crm-v2",
    "schema_id": "schema-uuid",
    "confirmed_mappings": [
      {
        "source_column": "Email_Addr",
        "target_key": "email",
        "was_ai_suggestion": true
      }
    ]
  }'
```
This endpoint stores these verified selections into the correction memory. Future uploads mapped with the same `product_id` and `schema_id` will heavily weight these previously confirmed matches.

### Transform Data
Retrieve the finally transformed dataset based on the confirmations:
```bash
curl -X POST http://localhost:3000/map/transform \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "job-uuid",
    "confirmed_mappings": [ ... ]
  }'
```

## Extending to PostgreSQL
While MapLayer currently uses `better-sqlite3` for fast, local persistent schema resolution, this acts as a capable prototype or low-concurrency production solution. 
To scale this across replicated environments, the `src/db/client.ts` and `src/services/corrections.ts` services can be interfaced with PostgreSQL using a querying engine like Knex, Prisma, or TypeORM. Be sure to migrate `schema.sql`.

### Auto-Detect Schema
If a SaaS platform does not know which schema an uploaded file belongs to, it can ask MapLayer to guess:
```bash
curl -X POST http://localhost:3000/map/detect-schema \
  -F "file=@/path/to/your/upload.csv" \
  -F "product_id=crm-v2"
```
**Response:**
```json
{
  "best_schema": "contact_list",
  "confidence": 0.91
}
```
