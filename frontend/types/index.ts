// ============================
// MapLayer API TypeScript Types
// ============================

// ---- Schemas ----
export interface TargetColumn {
  id: number;
  schema_id: number;
  key: string;
  label: string;
  data_type: string;
  description?: string;
}

export interface TargetSchemaResponse {
  id: string | number;
  product_id?: string;
  schema_name: string;
  schema_type?: "static" | "dynamic";
  created_at?: string;
  columns: TargetColumn[];
}

export interface TargetSchemaCreate {
  product_id: string;
  schema_name: string;
  columns: Omit<TargetColumn, "id" | "schema_id">[];
}

// ---- Datasets ----
export interface DatasetColumn {
  column_name: string;
  normalized_name?: string;
  data_type?: string;
}

export interface DatasetMetadata {
  id: string;
  product_id: string;
  original_filename: string;
  table_name: string;
  row_count: number;
  columns: (string | DatasetColumn)[];
  created_at: string;
  logical_dataset_id?: string;
  logical_dataset_name?: string;
}

export interface UploadResult {
  file_name?: string;
  filename?: string;        // legacy alias
  status: "success" | "error";
  dataset_id?: string;
  table_name?: string;
  columns?: { name: string; type: string }[];
  rows?: number;
  row_count?: number;       // legacy alias
  auto_mapped?: boolean;
  schema_type?: "static" | "dynamic" | null;
  mapped_to?: string;
  mapped_schema_id?: string;
  match_confidence?: number;
  column_mapping?: Record<string, string>;
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
  target_id: string;
  target_type: "logical" | "single";
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
  target_id: string;
  target_type: "logical" | "single";
  metrics: DiscoveredMetric[];
}

// ---- App State ----
export interface ComposeDraft {
  viewName: string;
  description: string;
  sources: Omit<CompositeViewSource, "id" | "composite_view_id">[];
}

export interface MappingDraft {
  selectedDatasetId: string | null;
  selectedSchemaId: string | null;
  columnMappings: Record<string, string>;
}

export interface AppStore {
  productId: string;
  productIds: string[];
  setProductId: (id: string) => void;
  // Drafts
  composeDraft: ComposeDraft;
  setComposeDraft: (draft: Partial<ComposeDraft>) => void;
  resetComposeDraft: () => void;
  
  mappingDraft: MappingDraft;
  setMappingDraft: (draft: Partial<MappingDraft>) => void;
  resetMappingDraft: () => void;
}

// ---- Preview ----
export interface PreviewData {
  columns: string[];
  rows: Record<string, unknown>[];
}

// ---- Mapping History ----
export interface MappingHistoryRecord {
  version: number;
  logical_dataset_id: string;
  logical_dataset_name: string;
  column_mapping: Record<string, string>;
  created_at: string;
  updated_at?: string;
  superseded_at?: string;
  status: "current" | "archived";
}

// ---- Composite Views ----
export interface CompositeViewSource {
  id?: number;
  composite_view_id?: string;
  dataset_type: "static" | "dynamic";
  dataset_id: string;
  dataset_name?: string;
  join_key: string;
  alias: string;
}

export interface CompositeView {
  id: string;
  product_id: string;
  view_name: string;
  description?: string;
  sources: CompositeViewSource[];
  created_at?: string;
}

// ---- Post-Processing Analytics Pipeline ----

export interface ColumnProfile {
  column_name: string;
  data_type: string | null;
  row_count: number | null;
  null_count: number | null;
  null_pct: number | null;
  distinct_count: number | null;
  min_value: string | null;
  max_value: string | null;
  mean_value: number | null;
  median_value: number | null;
  std_dev: number | null;
  top_values: { value: string; count: number }[];
}

export interface DatasetProfileResponse {
  logical_dataset_id: string;
  dataset_name: string;
  computed_at: string;
  columns: ColumnProfile[];
}

export interface DataAnomalyItem {
  id: number;
  column_name: string;
  row_index: number | null;
  value: string | null;
  method: "zscore" | "iqr" | "rare_categorical";
  reason: string | null;
  severity: "low" | "medium" | "high";
  computed_at: string;
}

export interface AnomalyResponse {
  logical_dataset_id: string;
  dataset_name: string;
  total_anomalies: number;
  anomalies: DataAnomalyItem[];
}

export interface TrendSeries {
  value_column: string;
  period: string;
  direction: "up" | "down" | "flat";
  slope: number | null;
  r_squared: number | null;
  series_data: { period: string; value: number }[];
}

export interface TrendResponse {
  logical_dataset_id: string;
  dataset_name: string;
  has_time_data: boolean;
  time_column: string | null;
  trends: TrendSeries[];
}

export interface DatasetInsightResponse {
  logical_dataset_id: string;
  dataset_name: string;
  narrative: string;
  bullet_points: string[];
  generated_at: string;
  is_cached: boolean;
}

export interface PendingResponse {
  status: "pending";
  message: string;
}

// ---- Per-File Analytics ----
export interface DatasetFileProfileResponse {
  dataset_id: string;
  file_name: string;
  computed_at: string;
  columns: ColumnProfile[];
}

export interface DatasetFileAnomalyResponse {
  dataset_id: string;
  file_name: string;
  total_anomalies: number;
  anomalies: DataAnomalyItem[];
}

export interface DatasetFileInsightResponse {
  dataset_id: string;
  file_name: string;
  narrative: string;
  bullet_points: string[];
  generated_at: string;
}

// ---- Quote / Value Comparison ----
export interface CompareRequest {
  group_by: string[];
  pivot_on: string;
  value_columns: string[];
  aggregation?: "first" | "min" | "max" | "avg";
  search?: string;
  limit?: number;
}

export interface CompareRow {
  key: Record<string, string>;
  values: Record<string, Record<string, unknown>>;
  best: Record<string, string>;
}

export interface CompareResponse {
  group_by: string[];
  pivot_on: string;
  pivot_values: string[];
  value_columns: string[];
  aggregation: string;
  rows: CompareRow[];
  row_count: number;
  missing_coverage: Record<string, number>;
}
