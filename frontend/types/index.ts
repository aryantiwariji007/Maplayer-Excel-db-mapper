// ============================
// MapLayer API TypeScript Types
// ============================

// ---- Schemas ----
export interface TargetColumn {
  id: number;
  schema_id: number;
  key: string;
  data_type: string;
  description?: string;
}

export interface TargetSchemaResponse {
  id: number;
  product_id: string;
  schema_name: string;
  created_at: string;
  columns: TargetColumn[];
}

export interface TargetSchemaCreate {
  product_id: string;
  schema_name: string;
  columns: Omit<TargetColumn, "id" | "schema_id">[];
}

// ---- Datasets ----
export interface DatasetMetadata {
  id: string;
  product_id: string;
  original_filename: string;
  table_name: string;
  row_count: number;
  columns: string[];
  created_at: string;
  logical_dataset_id?: string;
  logical_dataset_name?: string;
}

export interface UploadResult {
  filename: string;
  status: "success" | "error";
  dataset_id?: string;
  table_name?: string;
  columns?: string[];
  row_count?: number;
  auto_map_result?: MappingResult;
  auto_mapped?: boolean;
  mapped_to?: string;
  error?: string;
}

// ---- Logical Datasets ----
export interface LogicalDataset {
  id: string;
  dataset_name: string;
  table_name?: string;
  description?: string;
  created_at?: string;
}

export interface LogicalDatasetCreate {
  product_id: string;
  dataset_name: string;
  description?: string;
}

// ---- Mapping ----
export interface ColumnMapping {
  [sourceColumn: string]: string; // sourceColumn -> targetColumn
}

export interface MappingResult {
  schema_detected?: string;
  confidence?: number;
  column_mappings?: ColumnMapping;
  transformed_rows?: number;
  message?: string;
}

export interface MapConfirmRequest {
  product_id: string;
  schema_name: string;
  source_column: string;
  correct_target_key: string;
}

// ---- Analytics ----
export interface QueryRequest {
  product_id: string;
  sql_query: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
}

export interface MetricDefinition {
  id?: number;
  product_id: string;
  metric_name: string;
  logical_dataset_id: string;
  sql_expression: string;
  created_at?: string;
}

export interface MetricResult {
  metric_name: string;
  result: unknown;
}

export interface DiscoveredMetric {
  metric_name: string;
  sql_expression: string;
  description?: string;
}

export interface BulkSaveMetricsRequest {
  product_id: string;
  logical_dataset_id: string;
  metrics: DiscoveredMetric[];
}

// ---- App State ----
export interface AppStore {
  productId: string;
  setProductId: (id: string) => void;
}

// ---- Preview ----
export interface PreviewData {
  columns: string[];
  rows: Record<string, unknown>[];
}
