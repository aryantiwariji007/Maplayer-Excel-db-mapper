# MapLayer API Documentation

Welcome to the MapLayer API documentation. This document provides a comprehensive guide to all available endpoints for managing schemas, data ingestion, mapping, and analytics.

---

## 1. Schemas (`/schemas`)
Manage target canonical schemas for your datasets.

### `GET /schemas/`
List all target schemas.
- **Query Params**: `product_id` (optional)
- **Response**: List of `TargetSchemaResponse` objects.

### `POST /schemas/`
Create a new target schema.
- **Body**: `TargetSchemaCreate` (JSON)
- **Response**: Created `TargetSchemaResponse`.

### `DELETE /schemas/{schema_id}`
Delete a schema and its associated columns.
- **Path Params**: `schema_id`
- **Response**: Confirmation message.

---

## 2. Data Ingestion (`/ingest`)
Ingest physical files and manage dataset metadata.

### `POST /ingest/upload`
Upload a single raw dataset file. Supports parsing headers, inferring schema, creating physical tables, and suggesting mappings.
- **Form Data**: `file` (multipart), `product_id`, `auto_map` (optional), `logical_dataset_name` (optional).
- **Response**: Dataset metadata and schema.

### `POST /ingest/upload-bulk`
Upload multiple files simultaneously. Iterates over all attached files, performing schema inference, table creation, and auto-mapping for each, and returning an aggregated status array.
- **Form Data**: `files` (array of multipart files), `product_id`, `auto_map` (optional), `logical_dataset_name` (optional).
- **Response**: Consolidated processing results array for each file.

### `GET /ingest/datasets`
List all ingested datasets for a product.
- **Query Params**: `product_id`
- **Response**: List of dataset metadata summaries.

### `GET /ingest/datasets/{dataset_id}`
Get full metadata and schema for a specific dataset.
- **Path Params**: `dataset_id`

### `DELETE /ingest/datasets/{dataset_id}`
Delete dataset metadata and drop its physical table.
- **Path Params**: `dataset_id`

### `POST /ingest/logical-datasets`
Create a new named logical dataset (grouping concept).
- **Body**: `product_id`, `dataset_name`, `description`.

### `GET /ingest/logical-datasets`
List all logical datasets for a product.
- **Query Params**: `product_id`

### `POST /ingest/dataset/map`
Assign a physical dataset to a logical dataset with an explicit or AI-suggested column mapping.
- **Form Data**:
    - `dataset_id`: (string)
    - `logical_dataset_id`: (string)
    - `auto_map`: (boolean, default=false)
    - `column_mapping`: (optional, JSON string)
- **Response**: Confirmation of mapping and materialization.

---

## 3. Mapping Engine (`/map`)
AI-powered column mapping and transformations.

### `POST /map/`
Map an uploaded file to a specific schema (or auto-detect the best one).
- **Form Data**: `product_id`, `schema_name` (optional), `file`.

### `POST /map/confirm`
Record a user's manual correction for a schema mapping (reinforcement learning).
- **Body**: `product_id`, `schema_name`, `source_column`, `correct_target_key`.

### `POST /map/transform`
Transforms a file based on provided mapping JSON.
- **Form Data**: `file`, `mappings_json`.

### `POST /map/detect-schema`
Profiles a file and detects the best matching target schema without transforming.
- **Form Data**: `product_id`, `file`.

### `POST /map/auto-transform`
Auto-detects schema, maps columns, and returns the transformed data JSON.
- **Form Data**: `product_id`, `file`.

---

## 4. Analytics & Metrics (`/analytics`)
Query datasets and manage semantic metrics.

### `POST /analytics/query`
Run safe SQL (SELECT only) against a product's ingested tables.
- **Body**: `product_id`, `sql_query`.

### `GET /analytics/datasets/{id}/preview`
Preview the first 50 rows of a raw dataset.

### `GET /analytics/logical-datasets/{id}/preview`
Preview unified rows from a materialized logical dataset.

### `POST /analytics/metrics`
Define a reusable semantic business metric (SQL expression).
- **Body**: `product_id`, `metric_name`, `logical_dataset_id`, `sql_expression`.

### `GET /analytics/metrics`
List all defined metrics for a product.
- **Query Params**: `product_id`.

### `POST /analytics/metrics/query`
Execute a predefined metric and return the result.
- **Body**: `metric_id`.

### `GET /analytics/logical-datasets/{id}/discover-metrics`
**[NEW]** Use AI to automatically discover suggested business metrics for a dataset.

### `POST /analytics/metrics/bulk-save`
**[NEW]** Batch save multiple suggested metrics at once.
- **Body**: `product_id`, `logical_dataset_id`, `metrics` (list).
