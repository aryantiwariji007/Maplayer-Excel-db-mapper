# MapLayer API Documentation

**Version:** 3.0
**Base URL:** `http://localhost:8000` (local) | `https://<your-app>.up.railway.app` (production)
**Interactive docs:** `/docs` (Swagger UI) · `/redoc` (ReDoc)

---

## Table of Contents

1. [System](#1-system)
2. [Schemas — `/schemas`](#2-schemas----schemas)
3. [Mapping Engine — `/map`](#3-mapping-engine----map)
4. [Ingest — `/ingest`](#4-ingest----ingest)
   - [Single File Upload](#41-single-file-upload)
   - [Bulk / ZIP Upload](#42-bulk--zip-upload)
   - [Job Status](#43-job-status)
   - [Dataset Registry](#44-dataset-registry)
   - [Logical Datasets](#45-logical-datasets)
   - [Schema Utilities](#46-schema-utilities)
5. [Analytics — `/analytics`](#5-analytics----analytics)
   - [SQL Query](#51-sql-query)
   - [Data Previews](#52-data-previews)
   - [Semantic Metrics](#53-semantic-metrics)
   - [AI Metric Discovery](#54-ai-metric-discovery)
6. [Composite Views — `/composite`](#6-composite-views----composite)
7. [Error Codes](#7-error-codes)
8. [Common Concepts](#8-common-concepts)

---

## 1. System

### `GET /health`

Returns a simple liveness check. Use this for Railway / Vercel health probes.

**Response `200`**
```json
{
  "status": "ok",
  "service": "MapLayer",
  "version": "3.0"
}
```

---

### `GET /diag`

Returns diagnostic information about the runtime environment.

**Response `200`**
```json
{
  "status": "ok",
  "multipart_library": "installed",
  "pandas_version": "2.2.2",
  "version": "3.0.1"
}
```

---

## 2. Schemas — `/schemas`

Target schemas define the canonical column structure you want uploaded files to map towards. Each schema belongs to a `product_id` and contains one or more typed columns.

---

### `GET /schemas/`

List all target schemas. Optionally filter by product.

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | No | Filter schemas by product |

**Response `200`** — array of schema objects

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "product_id": "crm-v2",
    "schema_name": "Customer",
    "description": "Unified customer record",
    "columns": [
      {
        "id": 1,
        "key": "customer_id",
        "label": "Customer ID",
        "description": "Unique identifier",
        "data_type": "string",
        "required": true,
        "format_hint": null,
        "examples": ["C001", "C002"],
        "aliases": ["client_id", "cust_no"]
      }
    ]
  }
]
```

---

### `POST /schemas/`

Create a new target schema with its column definitions. Column embeddings are automatically synced to Qdrant for semantic matching.

**Request body** (`application/json`)

```json
{
  "product_id": "crm-v2",
  "schema_name": "Customer",
  "description": "Unified customer record",
  "columns": [
    {
      "key": "customer_id",
      "label": "Customer ID",
      "description": "Unique customer identifier",
      "data_type": "string",
      "required": true,
      "format_hint": "UUID or alphanumeric code",
      "examples": ["C001", "C002"],
      "aliases": ["client_id", "cust_no", "account_number"]
    },
    {
      "key": "full_name",
      "label": "Full Name",
      "description": "Customer's full name",
      "data_type": "string",
      "required": true,
      "format_hint": null,
      "examples": ["John Smith"],
      "aliases": ["name", "customer_name"]
    }
  ]
}
```

**Column fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | Yes | Unique key within the schema (snake_case) |
| `label` | string | Yes | Human-readable display name |
| `description` | string | No | Semantic description used in AI matching |
| `data_type` | string | Yes | `string`, `number`, `date`, `boolean` |
| `required` | boolean | No | Whether this column must be present |
| `format_hint` | string | No | Format guidance for the mapping engine |
| `examples` | array | No | Example values to improve matching accuracy |
| `aliases` | array | No | Alternative column names to recognize |

**Response `200`** — the created schema object (same shape as GET response)

**Error `400`** — schema with that `product_id` + `schema_name` already exists

---

### `DELETE /schemas/{schema_id}`

Delete a target schema and all its column definitions.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `schema_id` | string (UUID) | Schema ID |

**Response `200`**
```json
{ "message": "Schema deleted successfully" }
```

**Error `404`** — schema not found

---

## 3. Mapping Engine — `/map`

The mapping engine analyses uploaded file headers and scores them against a target schema using:
1. Exact and alias matching
2. Fuzzy string similarity (RapidFuzz)
3. Semantic similarity via Qdrant vector search
4. Data type compatibility scoring

---

### `POST /map/`

Upload a file to get AI-suggested column mappings. Optionally specify a target schema; if omitted, the engine picks the best-matching schema automatically.

**Request** (`multipart/form-data`)

| Field | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | Yes | Product namespace |
| `schema_name` | string | No | Target schema name. If omitted, best schema is auto-selected |
| `file` | file | Yes | CSV, XLS, or XLSX file |

**Response `200`**

```json
{
  "file": "sales_q1.csv",
  "detected_schema": "SalesOrder",
  "total_rows_detected": 1523,
  "mappings": [
    {
      "column": "Order No",
      "mapped_to": "order_id",
      "confidence": 0.92,
      "reason": "Matched via rules/semantics. Type: string",
      "status": "ready",
      "ambiguities": []
    },
    {
      "column": "Cust Name",
      "mapped_to": "customer_name",
      "confidence": 0.74,
      "reason": "Matched via rules/semantics. Type: string",
      "status": "review",
      "ambiguities": ["contact_name", "account_name"]
    },
    {
      "column": "XYZ_unknown",
      "mapped_to": null,
      "confidence": 0.0,
      "reason": "No match found",
      "status": "unmapped",
      "ambiguities": []
    }
  ]
}
```

**Mapping status values**

| Status | Meaning |
|---|---|
| `ready` | Confidence ≥ 0.85 — safe to use without review |
| `review` | Confidence 0.60–0.84 — user should confirm |
| `unmapped` | Confidence < 0.60 — no good match found |

**Error `400`** — file is empty or cannot be parsed
**Error `404`** — specified schema not found, or no schemas exist for the product

---

### `POST /map/confirm`

Record a manual correction. MapLayer stores this correction and applies it automatically for future uploads from the same product, improving AI accuracy over time.

**Request body** (`application/json`)

```json
{
  "product_id": "crm-v2",
  "schema_name": "Customer",
  "source_column": "Cust Name",
  "correct_target_key": "full_name",
  "incorrect_target_key": "contact_name"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | Yes | Product namespace |
| `schema_name` | string | Yes | Target schema name (or logical dataset name) |
| `source_column` | string | Yes | The source file's column header |
| `correct_target_key` | string | Yes | The correct target schema key |
| `incorrect_target_key` | string | No | The wrong key that was suggested |

**Response `200`**
```json
{
  "message": "Correction recorded successfully",
  "record_id": "7f3a1b22-..."
}
```

**Error `404`** — schema not found

---

### `POST /map/transform`

Apply user-confirmed mappings to an uploaded file and return the transformed rows as JSON.

**Request** (`multipart/form-data`)

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | Yes | CSV, XLS, or XLSX file |
| `mappings_json` | string (JSON) | Yes | Array of `{"source": "Col A", "target": "target_key"}` objects |

**`mappings_json` example**
```json
[
  { "source": "Order No", "target": "order_id" },
  { "source": "Cust Name", "target": "customer_name" },
  { "source": "Total", "target": "order_total" }
]
```

**Response `200`**
```json
{
  "transformed_rows": [
    { "order_id": "ORD-001", "customer_name": "Alice", "order_total": 450.00 },
    { "order_id": "ORD-002", "customer_name": "Bob", "order_total": 120.50 }
  ]
}
```

**Error `400`** — invalid `mappings_json` or empty file

---

### `POST /map/detect-schema`

Profile an uploaded file and detect which registered schema it best matches, without performing a full transform.

**Request** (`multipart/form-data`)

| Field | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | Yes | Product namespace |
| `file` | file | Yes | CSV, XLS, or XLSX file |

**Response `200`**
```json
{
  "detected_schema": "SalesOrder",
  "confidence": 0.87,
  "row_count": 1523,
  "headers": ["Order No", "Cust Name", "Total", "Date"],
  "mappings": [ "..." ]
}
```

**Error `404`** — no schemas registered for the product

---

### `POST /map/auto-transform`

Single-call convenience endpoint: detect schema (or use provided), map, and return transformed rows.

**Request** (`multipart/form-data`)

| Field | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | Yes | Product namespace |
| `schema_name` | string | No | Force a specific schema; omit to auto-detect |
| `file` | file | Yes | CSV, XLS, or XLSX file |

**Response `200`**
```json
{
  "file": "sales_q1.csv",
  "detected_schema": "SalesOrder",
  "transformed_rows": [
    { "order_id": "ORD-001", "customer_name": "Alice", "order_total": 450.00 }
  ]
}
```

**Error `404`** — schema not found or no schemas for product
**Error `400`** — file is empty or cannot be parsed

---

## 4. Ingest — `/ingest`

The ingest layer ingests raw files into dynamic PostgreSQL tables, tracks dataset metadata, and organises physical datasets into named Logical Datasets for unified analytics.

---

### 4.1 Single File Upload

### `POST /ingest/upload`

Upload a single CSV or Excel file. MapLayer:
1. Parses the file and detects column types
2. Creates a physical PostgreSQL table (`ds_{uuid}`)
3. Inserts all rows
4. Optionally auto-maps the dataset to a Logical Dataset

**Request** (`multipart/form-data`)

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | Yes | CSV, XLS, or XLSX |
| `product_id` | string | Yes | Product namespace (also accepted as `product-id`) |
| `auto_map` | boolean | No (default `false`) | Automatically detect and map to a Logical Dataset |
| `logical_dataset_name` | string | No | Force mapping into a specific Logical Dataset by name |

**Response `200`**
```json
{
  "dataset_id": "d1a2b3c4-...",
  "table_name": "ds_d1a2b3c4_...",
  "rows": 1523,
  "columns": [
    { "name": "order_id", "type": "string" },
    { "name": "order_total", "type": "number" },
    { "name": "order_date", "type": "date" }
  ],
  "status": "success",
  "file_name": "sales_q1.csv",
  "auto_mapped": true,
  "schema_type": "dynamic",
  "mapped_to": "Sales Orders",
  "mapped_schema_id": "ld-uuid-...",
  "match_confidence": 0.91,
  "column_mapping": {
    "order_id": "order_id",
    "order_total": "total_amount"
  },
  "logical_dataset_suggestions": [
    { "id": "ld-uuid-...", "dataset_name": "Sales Orders", "score": 0.91 }
  ]
}
```

**Error `400`** — file is empty or cannot be parsed
**Error `422`** — `product_id` missing, or file has no usable data after header detection
**Error `500`** — database error during table creation or row insertion

---

### 4.2 Bulk / ZIP Upload

### `POST /ingest/upload-bulk`

Upload multiple files or a ZIP archive asynchronously using Celery. Returns immediately with a `job_id` — poll `GET /ingest/jobs/{job_id}` for progress.

**Accepted file types:** CSV, XLS, XLSX, ZIP (ZIP contents are extracted; nested directories are walked recursively)

**Request** (`multipart/form-data`)

| Field | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | Yes | Product namespace |
| `files` | file[] | Yes | One or more files (CSV, Excel, or ZIP) |
| `auto_map` | boolean | No (default `false`) | Auto-map each ingested file to a Logical Dataset |
| `logical_dataset_name` | string | No | Target Logical Dataset name for all files in the batch |

**Response `202`**
```json
{
  "status": "accepted",
  "job_id": "job-uuid-...",
  "message": "Files queued for bulk processing."
}
```

**Error `400`** — no files provided

---

### 4.3 Job Status

### `GET /ingest/jobs/{job_id}`

Poll the status of a bulk upload job.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `job_id` | string (UUID) | Job ID returned by `/ingest/upload-bulk` |

**Response `200`**
```json
{
  "id": "job-uuid-...",
  "status": "COMPLETED",
  "total_files": 5,
  "processed_files": 5,
  "results": [
    { "file": "january.csv", "status": "success", "dataset_id": "d1..." },
    { "file": "february.csv", "status": "success", "dataset_id": "d2..." }
  ],
  "error": null,
  "updated_at": "2025-01-15T10:32:01.123Z"
}
```

**Job status values**

| Status | Meaning |
|---|---|
| `PENDING` | Job created, worker hasn't started yet |
| `PROCESSING` | Worker is actively processing files |
| `COMPLETED` | All files processed successfully |
| `FAILED` | An unrecoverable error occurred |

**Error `404`** — job not found

---

### 4.4 Dataset Registry

### `GET /ingest/datasets`

List all ingested datasets for a product, including their column names and logical dataset assignment.

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | Yes | Product namespace |

**Response `200`** — array of dataset summaries

```json
[
  {
    "id": "d1a2b3c4-...",
    "original_filename": "sales_q1.csv",
    "table_name": "ds_d1a2b3c4_...",
    "row_count": 1523,
    "created_at": "2025-01-15T09:00:00Z",
    "columns": ["order_id", "customer_name", "order_total"],
    "logical_dataset_id": "ld-uuid-...",
    "logical_dataset_name": "Sales Orders",
    "schema_type": "dynamic"
  }
]
```

---

### `GET /ingest/datasets/{dataset_id}`

Get full metadata for a single dataset, including detailed column type information.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `dataset_id` | string (UUID) | Dataset ID |

**Response `200`**
```json
{
  "id": "d1a2b3c4-...",
  "product_id": "crm-v2",
  "original_filename": "sales_q1.csv",
  "table_name": "ds_d1a2b3c4_...",
  "row_count": 1523,
  "created_at": "2025-01-15T09:00:00Z",
  "columns": [
    {
      "column_name": "Order No",
      "normalized_name": "order_no",
      "data_type": "string"
    }
  ]
}
```

**Error `404`** — dataset not found

---

### `DELETE /ingest/datasets/{dataset_id}`

Delete a dataset's metadata record and drop its physical PostgreSQL table.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `dataset_id` | string (UUID) | Dataset ID |

**Response `200`**
```json
{ "status": "deleted", "table_name": "ds_d1a2b3c4_..." }
```

If the table could not be dropped (e.g. already removed):
```json
{ "status": "metadata_deleted", "warning": "Could not drop table: ..." }
```

**Error `404`** — dataset not found

---

### `POST /ingest/dataset/map`

Map a physical dataset into a Logical Dataset. This materialises the dataset rows into the shared analytics table, applying the column mapping.

**Request body** (`application/json`)

```json
{
  "dataset_id": "d1a2b3c4-...",
  "logical_dataset_id": "ld-uuid-...",
  "column_mapping": {
    "order_no": "order_id",
    "cust_name": "customer_name",
    "total": "order_total"
  },
  "auto_map": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `dataset_id` | string | Yes | Source dataset ID |
| `logical_dataset_id` | string | Yes | Target Logical Dataset ID |
| `column_mapping` | object | No* | `{ "source_col": "target_key" }`. Use `"- skip -"` as value to exclude a column |
| `auto_map` | boolean | No (default `false`) | If `true`, generate column mapping automatically using AI similarity |

*`column_mapping` is required unless `auto_map` is `true`.

**Response `200`**
```json
{
  "detected_schema": "Sales Orders",
  "logical_dataset_id": "ld-uuid-...",
  "mappings_used": 3,
  "target_to_source_map": {
    "order_id": "order_no",
    "customer_name": "cust_name"
  },
  "sample_input_records": [ "..." ],
  "transformed_rows": [ "..." ]
}
```

**Error `400`** — dataset or logical dataset not found, no valid columns mapped

---

### `GET /ingest/datasets/{dataset_id}/mapping-history`

Return all past and current mapping versions for a dataset, newest first. Useful for auditing remapping events.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `dataset_id` | string (UUID) | Dataset ID |

**Response `200`** — array of mapping versions

```json
[
  {
    "version": 2,
    "logical_dataset_id": "ld-uuid-...",
    "logical_dataset_name": "Sales Orders",
    "column_mapping": { "order_no": "order_id" },
    "created_at": "2025-01-20T10:00:00Z",
    "updated_at": "2025-01-22T14:00:00Z",
    "status": "current"
  },
  {
    "version": 1,
    "logical_dataset_id": "ld-old-...",
    "logical_dataset_name": "Old Orders",
    "column_mapping": { "order_no": "ref_no" },
    "created_at": "2025-01-15T09:00:00Z",
    "superseded_at": "2025-01-20T10:00:00Z",
    "status": "archived"
  }
]
```

---

### `GET /ingest/datasets/{dataset_id}/preview-remapped`

Preview a dataset's raw rows with column names translated to their mapped target schema keys.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `dataset_id` | string (UUID) | Dataset ID |

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `mode` | string | `full` | `full` — all columns with mapped names applied; `mapped_only` — only mapped columns |

**Response `200`**
```json
{
  "columns": ["order_id", "customer_name", "order_total", "unmapped_col"],
  "rows": [
    { "order_id": "ORD-001", "customer_name": "Alice", "order_total": 450.0, "unmapped_col": "x" }
  ]
}
```

---

### 4.5 Logical Datasets

Logical Datasets are named, unified views that aggregate rows from multiple physical datasets using a shared column schema. Think of them as virtual tables that span many uploaded files.

---

### `POST /ingest/logical-datasets`

Create a new named Logical Dataset. An empty analytics table is provisioned in PostgreSQL.

**Request body** (`application/json`)

```json
{
  "product_id": "crm-v2",
  "dataset_name": "Sales Orders",
  "description": "Unified sales order data from all regional uploads"
}
```

**Response `200`**
```json
{
  "id": "ld-uuid-...",
  "dataset_name": "Sales Orders",
  "table_name": "analytics_abc123...",
  "created_at": "2025-01-15T09:00:00Z"
}
```

**Error `400`** — logical dataset with same `product_id` + `dataset_name` already exists

---

### `GET /ingest/logical-datasets`

List all Logical Datasets for a product.

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | Yes | Product namespace |

**Response `200`** — array of logical dataset summaries

```json
[
  {
    "id": "ld-uuid-...",
    "dataset_name": "Sales Orders",
    "table_name": "analytics_abc123...",
    "description": "Unified sales order data",
    "created_at": "2025-01-15T09:00:00Z"
  }
]
```

---

### `GET /ingest/logical-datasets/{logical_dataset_id}/source-files`

List all physical datasets that have been mapped into a Logical Dataset, including their column mappings.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `logical_dataset_id` | string (UUID) | Logical Dataset ID |

**Response `200`**
```json
[
  {
    "dataset_id": "d1a2b3c4-...",
    "file_name": "sales_q1.csv",
    "row_count": 1523,
    "column_mapping": { "order_no": "order_id", "total": "order_total" },
    "mapped_at": "2025-01-15T10:00:00Z"
  },
  {
    "dataset_id": "d2e3f4g5-...",
    "file_name": "sales_q2.csv",
    "row_count": 1820,
    "column_mapping": { "order_number": "order_id", "amount": "order_total" },
    "mapped_at": "2025-04-01T08:30:00Z"
  }
]
```

**Error `404`** — logical dataset not found

---

### 4.6 Schema Utilities

### `GET /ingest/all-schemas`

List all schemas for a product in a unified format — includes both static (registered target schemas) and dynamic (logical datasets).

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | Yes | Product namespace |

**Response `200`**
```json
[
  {
    "id": "schema-uuid-...",
    "schema_name": "Customer",
    "schema_type": "static",
    "description": "Registered target schema",
    "columns": [
      { "key": "customer_id", "data_type": "string", "required": true, "description": "Unique ID" }
    ]
  },
  {
    "id": "ld-uuid-...",
    "schema_name": "Sales Orders",
    "schema_type": "dynamic",
    "description": "Unified sales order data",
    "columns": [
      { "key": "order_id", "data_type": "text", "required": false, "description": "" }
    ]
  }
]
```

---

## 5. Analytics — `/analytics`

---

### 5.1 SQL Query

### `POST /analytics/query`

Run a raw `SELECT` SQL query against any dataset table belonging to the product.

**Security constraints:**
- Only `SELECT` statements are allowed (non-SELECT → `400`)
- All table references must belong to the provided `product_id` (cross-product access → `403`)

**Request body** (`application/json`)

```json
{
  "product_id": "crm-v2",
  "sql_query": "SELECT customer_name, SUM(order_total) as revenue FROM \"analytics_abc123\" GROUP BY customer_name ORDER BY revenue DESC LIMIT 10"
}
```

> **Tip:** PostgreSQL auto-lowercases unquoted identifiers. Wrap table names and column names with `"double quotes"` if they contain uppercase letters or special characters.

**Response `200`**
```json
{
  "columns": ["customer_name", "revenue"],
  "row_count": 10,
  "rows": [
    { "customer_name": "Acme Corp", "revenue": 125430.50 },
    { "customer_name": "Globex", "revenue": 98200.00 }
  ]
}
```

**Error `400`** — non-SELECT query, or SQL execution failed
**Error `403`** — query references tables not owned by `product_id`

---

### 5.2 Data Previews

### `GET /analytics/datasets/{dataset_id}/preview`

Return the first N rows from a physical dataset's table.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `dataset_id` | string (UUID) | Dataset ID |

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `50` | Number of rows to return (max 500) |

**Response `200`**
```json
{
  "dataset_id": "d1a2b3c4-...",
  "table_name": "ds_d1a2b3c4_...",
  "columns": ["order_id", "customer_name", "order_total"],
  "row_count": 50,
  "rows": [ "..." ]
}
```

**Error `404`** — dataset not found

---

### `GET /analytics/logical-datasets/{logical_dataset_id}/preview`

Return the first N rows from a Logical Dataset's materialized analytics table. Each row includes a `source_file` column indicating which uploaded file it originated from.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `logical_dataset_id` | string (UUID) | Logical Dataset ID |

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `50` | Number of rows to return (max 500) |

**Response `200`**
```json
{
  "logical_dataset": "Sales Orders",
  "table_name": "analytics_abc123...",
  "columns": ["source_file", "order_id", "customer_name", "order_total"],
  "row_count": 50,
  "rows": [
    { "source_file": "sales_q1.csv", "order_id": "ORD-001", "customer_name": "Alice", "order_total": 450.0 }
  ]
}
```

If no data has been mapped yet:
```json
{
  "logical_dataset": "Sales Orders",
  "columns": [],
  "row_count": 0,
  "rows": [],
  "message": "No data mapped yet."
}
```

**Error `404`** — logical dataset not found

---

### 5.3 Semantic Metrics

Metrics are reusable named SQL expressions (e.g. `SUM(order_total)`) that can be defined once and evaluated on demand.

---

### `POST /analytics/metrics`

Define a new semantic metric.

**Request body** (`application/json`)

```json
{
  "product_id": "crm-v2",
  "metric_name": "Total Revenue",
  "target_id": "ld-uuid-...",
  "target_type": "logical",
  "sql_expression": "SUM(order_total)",
  "description": "Sum of all order totals in the unified sales dataset"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | Yes | Product namespace |
| `metric_name` | string | Yes | Human-readable metric name |
| `target_id` | string | Yes | ID of the Logical Dataset or Dataset to run the metric against |
| `target_type` | string | No (default `logical`) | `logical` or `single` |
| `sql_expression` | string | Yes | SQL aggregate expression (e.g. `SUM(col)`, `AVG(col)`, `COUNT(*)`) |
| `description` | string | No | Description of what the metric measures |

**Response `200`**
```json
{
  "status": "created",
  "metric_id": "metric-uuid-...",
  "metric_name": "Total Revenue"
}
```

**Error `400`** — expression contains `DROP`, `DELETE`, `UPDATE`, or `INSERT`
**Error `404`** — target dataset not found

---

### `GET /analytics/metrics`

List all defined metrics for a product.

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | Yes | Product namespace |

**Response `200`** — array of metric objects

```json
[
  {
    "id": "metric-uuid-...",
    "metric_name": "Total Revenue",
    "target_id": "ld-uuid-...",
    "target_type": "logical",
    "logical_dataset_id": "ld-uuid-...",
    "dataset_id": null,
    "sql_expression": "SUM(order_total)",
    "description": "Sum of all order totals"
  }
]
```

---

### `POST /analytics/metrics/query`

Execute a previously defined metric and return its calculated value.

**Request body** (`application/json`)

```json
{
  "metric_id": "metric-uuid-..."
}
```

**Response `200`**
```json
{
  "metric_name": "Total Revenue",
  "value": 1254300.50,
  "result_set": [
    { "Total Revenue": 1254300.50 }
  ]
}
```

**Error `404`** — metric not found, or target table missing
**Error `500`** — SQL execution failed

---

### `POST /analytics/metrics/bulk-save`

Save multiple metrics at once (e.g. after AI discovery).

**Request body** (`application/json`)

```json
{
  "product_id": "crm-v2",
  "target_id": "ld-uuid-...",
  "target_type": "logical",
  "metrics": [
    {
      "metric_name": "Total Revenue",
      "sql_expression": "SUM(order_total)",
      "description": "Sum of all order totals"
    },
    {
      "metric_name": "Average Order Value",
      "sql_expression": "AVG(order_total)",
      "description": "Mean order value"
    }
  ]
}
```

**Response `200`**
```json
{
  "status": "success",
  "saved_count": 2,
  "metric_ids": ["metric-uuid-1", "metric-uuid-2"]
}
```

**Error `404`** — target dataset not found or `product_id` mismatch
**Error `400`** — database error during save

---

### 5.4 AI Metric Discovery

### `GET /analytics/discover-metrics`

Ask Gemini AI to suggest business metrics for a dataset by analysing its column names and a sample of its data.

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target_id` | string | Yes | Logical Dataset or Dataset ID |
| `target_type` | string | No (default `logical`) | `logical` or `single` |

**Response `200`**
```json
{
  "target_id": "ld-uuid-...",
  "target_type": "logical",
  "dataset_name": "Sales Orders",
  "suggested_metrics": [
    {
      "metric_name": "Total Revenue",
      "sql_expression": "SUM(order_total)",
      "description": "Total value of all sales orders"
    },
    {
      "metric_name": "Average Order Value",
      "sql_expression": "AVG(order_total)",
      "description": "Average value per sales order"
    },
    {
      "metric_name": "Order Count",
      "sql_expression": "COUNT(*)",
      "description": "Total number of sales orders"
    }
  ]
}
```

**Error `400`** — table is empty or has no data mapped yet
**Error `404`** — target dataset not found

---

## 6. Composite Views — `/composite`

Composite views define a saved JOIN across two or more Logical Datasets (or static target schema tables), letting you query them as a single unified view.

---

### `POST /composite/views`

Create and save a composite view definition.

**Request body** (`application/json`)

```json
{
  "product_id": "crm-v2",
  "view_name": "Orders + Customers",
  "description": "Join sales orders with customer records",
  "sources": [
    {
      "dataset_type": "dynamic",
      "dataset_id": "ld-orders-uuid-...",
      "join_key": "customer_id",
      "alias": "orders"
    },
    {
      "dataset_type": "dynamic",
      "dataset_id": "ld-customers-uuid-...",
      "join_key": "customer_id",
      "alias": "customers"
    }
  ]
}
```

**Sources array — each item**

| Field | Type | Required | Description |
|---|---|---|---|
| `dataset_type` | string | Yes | `dynamic` (Logical Dataset) or `static` (TargetSchema) |
| `dataset_id` | string | Yes | Logical Dataset ID or TargetSchema ID |
| `join_key` | string | Yes | Column name to join on (case-insensitive, compared as TEXT) |
| `alias` | string | Yes | Short alias used in the generated SQL |

At least 2 sources are required.

**Response `200`** — the saved view object

```json
{
  "id": "view-uuid-...",
  "product_id": "crm-v2",
  "view_name": "Orders + Customers",
  "description": "Join sales orders with customer records",
  "sources": [
    {
      "dataset_type": "dynamic",
      "dataset_id": "ld-orders-uuid-...",
      "dataset_name": "Sales Orders",
      "table_name": "analytics_abc...",
      "join_key": "customer_id",
      "alias": "orders"
    },
    {
      "dataset_type": "dynamic",
      "dataset_id": "ld-customers-uuid-...",
      "dataset_name": "Customers",
      "table_name": "analytics_def...",
      "join_key": "customer_id",
      "alias": "customers"
    }
  ]
}
```

**Error `400`** — fewer than 2 sources provided
**Error `404`** — one or more source dataset IDs not found

---

### `GET /composite/views`

List all saved composite views for a product.

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `product_id` | string | Yes | Product namespace |

**Response `200`** — array of view objects (same shape as create response)

---

### `GET /composite/views/{view_id}/query`

Execute a simple preview of a composite view — runs the base JOIN and returns rows.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `view_id` | string (UUID) | Composite view ID |

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `200` | Number of rows to return |

**Response `200`**
```json
{
  "columns": ["customer_id", "order_id", "order_total", "customer_name", "region"],
  "rows": [ "..." ],
  "sql": "SELECT orders.*, customers.* FROM \"analytics_abc\" AS orders LEFT JOIN \"analytics_def\" AS customers ON orders.\"customer_id\"::TEXT = customers.\"customer_id\"::TEXT LIMIT 200"
}
```

**Error `400`** — insufficient sources or query failed
**Error `404`** — view not found

---

### `POST /composite/views/{view_id}/analyze`

Run an arbitrary `SELECT` query on top of the composite view using a CTE. The JOIN is automatically wrapped as `composite_view` for you to query against.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `view_id` | string (UUID) | Composite view ID |

**Request body** (`application/json`)

```json
{
  "sql_query": "SELECT region, SUM(order_total) as revenue FROM composite_view GROUP BY region ORDER BY revenue DESC"
}
```

The CTE alias `composite_view` refers to the full JOIN result. Your query must start with `SELECT`.

**Response `200`**
```json
{
  "columns": ["region", "revenue"],
  "rows": [
    { "region": "EMEA", "revenue": 540000.00 },
    { "region": "APAC", "revenue": 320000.00 }
  ],
  "sql": "WITH composite_view AS (...) SELECT region, SUM(order_total) ...",
  "row_count": 2
}
```

**Error `400`** — non-SELECT query, analysis failed, or insufficient sources
**Error `404`** — view not found

---

### `GET /composite/views/{view_id}/discover-metrics`

Ask Gemini AI to suggest business metrics based on the composite view's joined column set and sample data.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `view_id` | string (UUID) | Composite view ID |

**Response `200`**
```json
{
  "view_id": "view-uuid-...",
  "view_name": "Orders + Customers",
  "suggested_metrics": [
    {
      "metric_name": "Revenue by Region",
      "sql_expression": "SUM(order_total)",
      "description": "Total revenue grouped by customer region"
    }
  ]
}
```

**Error `400`** — no data in joined view, or insufficient sources
**Error `404`** — view not found

---

### `DELETE /composite/views/{view_id}`

Delete a saved composite view. This only removes the view definition — no underlying data is deleted.

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `view_id` | string (UUID) | Composite view ID |

**Response `200`**
```json
{ "message": "Composite view deleted." }
```

**Error `404`** — view not found

---

## 7. Error Codes

| Status | Meaning |
|---|---|
| `400` | Bad request — invalid input, empty file, non-SELECT SQL, or business rule violation |
| `403` | Forbidden — query references tables not owned by the provided `product_id` |
| `404` | Not found — the requested resource does not exist |
| `422` | Unprocessable entity — required field missing or file has no usable data |
| `500` | Internal server error — unexpected database or processing failure |

All error responses follow the FastAPI default shape:

```json
{
  "detail": "Human-readable error message"
}
```

---

## 8. Common Concepts

### `product_id`

A string namespace that scopes all data (schemas, datasets, metrics, views) to a single product or tenant. Use a stable, unique identifier for your product (e.g. `crm-v2`, `erp-prod`). There is no API to create or manage products — any string value is accepted.

### Dataset vs Logical Dataset

| | **Dataset** | **Logical Dataset** |
|---|---|---|
| Created by | Uploading a file | `POST /ingest/logical-datasets` or auto-created on upload |
| Physical table | One per file (`ds_{uuid}`) | One shared analytics table (`analytics_{uuid}`) |
| Purpose | Raw file storage | Unified view across many uploads |
| Queried via | `GET /analytics/datasets/{id}/preview` | `GET /analytics/logical-datasets/{id}/preview` |

### Static vs Dynamic Schemas

| | **Static schema** | **Dynamic schema (Logical Dataset)** |
|---|---|---|
| Created by | `POST /schemas/` | `POST /ingest/logical-datasets` |
| Structure | Fixed, defined upfront | Evolves as new files are mapped |
| Used for | Enforcing a known target format | Aggregating many files with varying headers |

### Column Mapping Format

Throughout the API, column mappings are represented as plain JSON objects:

```json
{
  "source_column_normalized": "target_schema_key"
}
```

- Keys are the **normalized** source column names (lowercased, spaces replaced with underscores)
- Values are the **target schema key** (as defined in the schema's `columns[].key`)
- Use `"- skip -"` as the value to exclude a column from the mapping

### Endpoint Quick Reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/diag` | Runtime diagnostics |
| GET | `/schemas/` | List target schemas |
| POST | `/schemas/` | Create target schema |
| DELETE | `/schemas/{id}` | Delete target schema |
| POST | `/map/` | Get column mappings for file |
| POST | `/map/confirm` | Record manual correction |
| POST | `/map/transform` | Transform file with confirmed mappings |
| POST | `/map/detect-schema` | Detect best schema for file |
| POST | `/map/auto-transform` | Auto-detect + transform in one call |
| POST | `/ingest/upload` | Upload single file |
| POST | `/ingest/upload-bulk` | Upload multiple files / ZIP (async) |
| GET | `/ingest/jobs/{job_id}` | Poll bulk upload job status |
| GET | `/ingest/datasets` | List datasets for product |
| GET | `/ingest/datasets/{id}` | Get dataset metadata |
| DELETE | `/ingest/datasets/{id}` | Delete dataset + drop table |
| POST | `/ingest/dataset/map` | Map dataset into logical dataset |
| GET | `/ingest/datasets/{id}/mapping-history` | Mapping version history |
| GET | `/ingest/datasets/{id}/preview-remapped` | Preview with remapped columns |
| POST | `/ingest/logical-datasets` | Create logical dataset |
| GET | `/ingest/logical-datasets` | List logical datasets |
| GET | `/ingest/logical-datasets/{id}/source-files` | List source files in logical dataset |
| GET | `/ingest/all-schemas` | List all schemas (static + dynamic) |
| POST | `/analytics/query` | Run SQL query |
| GET | `/analytics/datasets/{id}/preview` | Preview dataset rows |
| GET | `/analytics/logical-datasets/{id}/preview` | Preview logical dataset rows |
| POST | `/analytics/metrics` | Create metric |
| GET | `/analytics/metrics` | List metrics |
| POST | `/analytics/metrics/query` | Execute metric |
| POST | `/analytics/metrics/bulk-save` | Save multiple metrics |
| GET | `/analytics/discover-metrics` | AI metric discovery |
| POST | `/composite/views` | Create composite view |
| GET | `/composite/views` | List composite views |
| GET | `/composite/views/{id}/query` | Preview composite view |
| POST | `/composite/views/{id}/analyze` | Analyze with custom SQL on view |
| GET | `/composite/views/{id}/discover-metrics` | AI metrics for composite view |
| DELETE | `/composite/views/{id}` | Delete composite view |
