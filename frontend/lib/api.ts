import axios from "axios";
import type {
  TargetSchemaResponse,
  TargetSchemaCreate,
  TargetSchemaUpdate,
  DatasetMetadata,
  UploadResult,
  LogicalDataset,
  LogicalDatasetCreate,
  MappingResult,
  MapConfirmRequest,
  QueryRequest,
  QueryResult,
  MetricDefinition,
  MetricResult,
  DiscoveredMetric,
  BulkSaveMetricsRequest,
  PreviewData,
  MappingHistoryRecord,
  CompositeView,
  DatasetProfileResponse,
  AnomalyResponse,
  TrendResponse,
  DatasetInsightResponse,
  PendingResponse,
  DatasetFileProfileResponse,
  DatasetFileAnomalyResponse,
  DatasetFileInsightResponse,
  PdfPreviewResponse,
  PdfExtractResponse,
  PdfAnalyzeResponse,
  DynamicColumnDef,
} from "@/types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000",
  timeout: 60000,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.data && error.response.data.detail) {
      // Re-throw with the actual backend error message string
      return Promise.reject(new Error(error.response.data.detail));
    }
    return Promise.reject(error);
  }
);

// =============================
// SCHEMAS — /schemas
// =============================
export const schemasApi = {
  list: (productId?: string): Promise<TargetSchemaResponse[]> =>
    api
      .get("/schemas/", { params: productId ? { product_id: productId } : {} })
      .then((r) => r.data),

  getOne: (schemaId: string): Promise<TargetSchemaResponse> =>
    api.get(`/schemas/${schemaId}`).then((r) => r.data),

  create: (data: TargetSchemaCreate): Promise<TargetSchemaResponse> =>
    api.post("/schemas/", data).then((r) => r.data),

  update: (schemaId: string, data: TargetSchemaUpdate): Promise<TargetSchemaResponse> =>
    api.put(`/schemas/${schemaId}`, data).then((r) => r.data),

  delete: (schemaId: string | number): Promise<{ message: string }> =>
    api.delete(`/schemas/${schemaId}`).then((r) => r.data),
};

// =============================
// INGEST — /ingest
// =============================
export const ingestApi = {
  uploadSingle: (
    file: File,
    productId: string,
    autoMap?: boolean,
    logicalDatasetName?: string
  ): Promise<UploadResult> => {
    const form = new FormData();
    form.append("file", file);
    form.append("product_id", productId);
    if (autoMap !== undefined) form.append("auto_map", String(autoMap));
    if (logicalDatasetName)
      form.append("logical_dataset_name", logicalDatasetName);
    return api.post("/ingest/upload", form).then((r) => r.data);
  },

  uploadBulk: (
    files: File[],
    productId: string,
    autoMap?: boolean,
    logicalDatasetName?: string
  ): Promise<{ job_id: string }> => {
    const form = new FormData();
    // All file types (CSV, Excel, ZIP) go through the same "files" field.
    // ZIP files are extracted server-side by the background worker.
    files.forEach((f) => form.append("files", f));
    form.append("product_id", productId);
    if (autoMap !== undefined) form.append("auto_map", String(autoMap));
    if (logicalDatasetName)
      form.append("logical_dataset_name", logicalDatasetName);
    return api.post("/ingest/upload-bulk", form, { timeout: 120000 }).then((r) => r.data);
  },

  getJobStatus: (jobId: string): Promise<{
    id: string;
    status: string;
    total_files: number;
    processed_files: number;
    results: UploadResult[] | null;
    error: string | null;
    updated_at: string;
  }> => api.get(`/ingest/jobs/${jobId}`).then((r) => r.data),

  listDatasets: (productId: string): Promise<DatasetMetadata[]> =>
    api
      .get("/ingest/datasets", { params: { product_id: productId } })
      .then((r) => r.data),

  getDataset: (datasetId: string): Promise<DatasetMetadata> =>
    api.get(`/ingest/datasets/${datasetId}`).then((r) => r.data),

  deleteDataset: (datasetId: string): Promise<{ message: string }> =>
    api.delete(`/ingest/datasets/${datasetId}`).then((r) => r.data),

  unmapDataset: (datasetId: string): Promise<{ status: string; dataset_id: string }> =>
    api.delete(`/ingest/datasets/${datasetId}/mapping`).then((r) => r.data),

  createLogicalDataset: (data: LogicalDatasetCreate): Promise<LogicalDataset> =>
    api.post("/ingest/logical-datasets", data).then((r) => r.data),

  deleteLogicalDataset: (id: string): Promise<{ message: string }> =>
    api.delete(`/ingest/logical-datasets/${id}`).then((r) => r.data),

  listLogicalDatasets: (productId: string): Promise<LogicalDataset[]> =>
    api
      .get("/ingest/logical-datasets", { params: { product_id: productId } })
      .then((r) => r.data),

  listAllSchemas: (productId: string): Promise<TargetSchemaResponse[]> =>
    api
      .get("/ingest/all-schemas", { params: { product_id: productId } })
      .then((r) => r.data),

  mapDatasetToLogical: (
    datasetId: string,
    logicalDatasetId?: string,
    autoMap?: boolean,
    columnMapping?: Record<string, string>
  ): Promise<{
    message?: string;
    detected_schema?: string;
    logical_dataset_id?: string;
    target_to_source_map?: Record<string, string>;
    mappings_used?: number;
  }> => {
    const form = new FormData();
    form.append("dataset_id", datasetId);
    if (logicalDatasetId) form.append("logical_dataset_id", logicalDatasetId);
    if (autoMap !== undefined) form.append("auto_map", String(autoMap));
    if (columnMapping)
      form.append("column_mapping", JSON.stringify(columnMapping));
    // AI mapping can take >60s on complex files — use 3-minute timeout
    return api.post("/ingest/dataset/map", form, { timeout: 180000 }).then((r) => r.data);
  },

  mappingHistory: (datasetId: string): Promise<MappingHistoryRecord[]> =>
    api.get(`/ingest/datasets/${datasetId}/mapping-history`).then((r) => r.data),

  previewRemapped: (datasetId: string, mode: "full" | "mapped_only" = "full"): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> =>
    api.get(`/ingest/datasets/${datasetId}/preview-remapped`, { params: { mode } }).then((r) => r.data),

  bulkSaveCorrections: (
    productId: string,
    schemaName: string,
    columnMapping?: Record<string, string>,
    excludeDatasetId?: string
  ): Promise<{
    saved_datasets: number;
    saved_corrections: number;
    remapped_datasets: number;
    schema_name: string;
  }> => {
    const form = new FormData();
    form.append("product_id", productId);
    form.append("schema_name", schemaName);
    if (columnMapping) form.append("column_mapping", JSON.stringify(columnMapping));
    if (excludeDatasetId) form.append("exclude_dataset_id", excludeDatasetId);
    return api.post("/ingest/schema/bulk-corrections", form).then((r) => r.data);
  },

  listSourceFiles: (logicalDatasetId: string): Promise<{
    dataset_id: string;
    file_name: string;
    row_count: number;
    column_mapping: Record<string, string>;
    mapped_at: string;
  }[]> =>
    api.get(`/ingest/logical-datasets/${logicalDatasetId}/source-files`).then((r) => r.data),
};

export const compositeApi = {
  list: (productId: string): Promise<CompositeView[]> =>
    api.get("/composite/views", { params: { product_id: productId } }).then((r) => r.data),

  create: (data: {
    product_id: string;
    view_name: string;
    description?: string;
    sources: { dataset_type: string; dataset_id: string; join_key: string; alias: string }[];
  }): Promise<CompositeView> =>
    api.post("/composite/views", data).then((r) => r.data),

  query: (viewId: string, limit = 200): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> =>
    api.get(`/composite/views/${viewId}/query`, { params: { limit } }).then((r) => r.data),

  delete: (viewId: string): Promise<{ message: string }> =>
    api.delete(`/composite/views/${viewId}`).then((r) => r.data),

  analyze: (viewId: string, sql: string): Promise<QueryResult & { sql: string }> =>
    api.post(`/composite/views/${viewId}/analyze`, { sql_query: sql }).then((r) => r.data),

  discoverMetrics: (viewId: string): Promise<DiscoveredMetric[]> =>
    api
      .get(`/composite/views/${viewId}/discover-metrics`)
      .then((r) => r.data.suggested_metrics),
};

// =============================
// MAPPING ENGINE — /map
// =============================
export const mapApi = {
  mapFile: (
    productId: string,
    file: File,
    schemaName?: string
  ): Promise<MappingResult> => {
    const form = new FormData();
    form.append("product_id", productId);
    form.append("file", file);
    if (schemaName) form.append("schema_name", schemaName);
    return api.post("/map/", form).then((r) => r.data);
  },

  confirm: (data: MapConfirmRequest): Promise<{ message: string }> =>
    api.post("/map/confirm", data).then((r) => r.data),

  transform: (
    file: File,
    mappingsJson: Record<string, string>
  ): Promise<MappingResult> => {
    const form = new FormData();
    form.append("file", file);
    form.append("mappings_json", JSON.stringify(mappingsJson));
    return api.post("/map/transform", form).then((r) => r.data);
  },

  detectSchema: (
    productId: string,
    file: File
  ): Promise<{
    schema_name: string;
    confidence: number;
    column_mappings: Record<string, string>;
  }> => {
    const form = new FormData();
    form.append("product_id", productId);
    form.append("file", file);
    return api.post("/map/detect-schema", form).then((r) => r.data);
  },

  autoTransform: (productId: string, file: File): Promise<MappingResult> => {
    const form = new FormData();
    form.append("product_id", productId);
    form.append("file", file);
    return api.post("/map/auto-transform", form).then((r) => r.data);
  },
};

// =============================
// ANALYTICS — /analytics
// =============================
export const analyticsApi = {
  query: (data: QueryRequest): Promise<QueryResult> =>
    api.post("/analytics/query", data).then((r) => r.data),

  previewDataset: (datasetId: string): Promise<PreviewData> =>
    api.get(`/analytics/datasets/${datasetId}/preview`).then((r) => r.data),

  previewLogicalDataset: (id: string): Promise<PreviewData> =>
    api
      .get(`/analytics/logical-datasets/${id}/preview`)
      .then((r) => r.data),

  createMetric: (data: MetricDefinition): Promise<MetricDefinition> =>
    api.post("/analytics/metrics", data).then((r) => r.data),

  listMetrics: (productId: string): Promise<MetricDefinition[]> =>
    api
      .get("/analytics/metrics", { params: { product_id: productId } })
      .then((r) => r.data),

  runMetric: (metricId: number): Promise<MetricResult> =>
    api.post("/analytics/metrics/query", { metric_id: metricId }).then((r) => r.data),

  discoverMetrics: (targetId: string, targetType: "logical" | "single" = "logical"): Promise<DiscoveredMetric[]> =>
    api
      .get(`/analytics/discover-metrics`, { params: { target_id: targetId, target_type: targetType } })
      .then((r) => r.data.suggested_metrics),

  bulkSaveMetrics: (data: BulkSaveMetricsRequest): Promise<MetricDefinition[]> =>
    api.post("/analytics/metrics/bulk-save", data).then((r) => r.data),

  getProfile: (logicalDatasetId: string): Promise<DatasetProfileResponse | PendingResponse> =>
    api.get(`/analytics/logical-datasets/${logicalDatasetId}/profile`).then((r) => r.data),

  getAnomalies: (
    logicalDatasetId: string,
    params?: { column?: string; severity?: string; limit?: number }
  ): Promise<AnomalyResponse | PendingResponse> =>
    api
      .get(`/analytics/logical-datasets/${logicalDatasetId}/anomalies`, { params })
      .then((r) => r.data),

  getTrends: (logicalDatasetId: string): Promise<TrendResponse | PendingResponse> =>
    api.get(`/analytics/logical-datasets/${logicalDatasetId}/trends`).then((r) => r.data),

  getInsight: (logicalDatasetId: string): Promise<DatasetInsightResponse | PendingResponse> =>
    api.get(`/analytics/logical-datasets/${logicalDatasetId}/insight`).then((r) => r.data),

  getFileProfile: (datasetId: string): Promise<DatasetFileProfileResponse | PendingResponse> =>
    api.get(`/analytics/datasets/${datasetId}/profile`).then((r) => r.data),

  getFileAnomalies: (
    datasetId: string,
    params?: { column?: string; severity?: string; limit?: number }
  ): Promise<DatasetFileAnomalyResponse | PendingResponse> =>
    api.get(`/analytics/datasets/${datasetId}/anomalies`, { params }).then((r) => r.data),

  getFileInsight: (datasetId: string): Promise<DatasetFileInsightResponse | PendingResponse> =>
    api.get(`/analytics/datasets/${datasetId}/insight`).then((r) => r.data),

  compareLogicalDataset: (
    logicalDatasetId: string,
    request: import("@/types").CompareRequest
  ): Promise<import("@/types").CompareResponse> =>
    api.post(`/analytics/logical-datasets/${logicalDatasetId}/compare`, request).then((r) => r.data),

  compareTargetSchema: (
    schemaId: string | number,
    request: import("@/types").CompareRequest
  ): Promise<import("@/types").CompareResponse> =>
    api.post(`/analytics/target-schemas/${schemaId}/compare`, request).then((r) => r.data),

  suggestComparison: (
    schemaName: string,
    columns: { key: string; data_type?: string }[]
  ): Promise<{ group_by: string[]; value_columns: string[]; aggregation: string; rationale: string }> =>
    api.post("/analytics/suggest-comparison", { schema_name: schemaName, columns }).then((r) => r.data),

  compareNarrative: (data: {
    schema_name: string;
    pivot_values: string[];
    value_columns: string[];
    aggregation: string;
    vendor_stats: Record<string, Record<string, { min: number | null; max: number | null; avg: number | null; count: number }>>;
    best_vendor: Record<string, string>;
    row_count: number;
    coverage_stats: Record<string, number>;
  }): Promise<{ headline: string; bullets: string[]; recommendation: string }> =>
    api.post("/analytics/compare-narrative", data).then((r) => r.data),
};

// =============================
// PDF EXTRACTION — /pdf
// =============================
export const pdfApi = {
  previewPage: (file: File, pageNum: number): Promise<PdfPreviewResponse> => {
    const form = new FormData();
    form.append("file", file);
    form.append("page_num", String(pageNum));
    return api.post("/pdf/preview", form, { timeout: 30000 }).then((r) => r.data);
  },

  analyzeTable: (
    file: File,
    pageNum: number,
    productId: string
  ): Promise<PdfAnalyzeResponse> => {
    const form = new FormData();
    form.append("file", file);
    form.append("page_num", String(pageNum));
    form.append("product_id", productId);
    return api.post("/pdf/analyze", form, { timeout: 90000 }).then((r) => r.data);
  },

  extractData: (
    file: File,
    pageNum: number,
    productId: string,
    options: { schemaId?: string; dynamicColumns?: DynamicColumnDef[]; hint?: string }
  ): Promise<PdfExtractResponse> => {
    const form = new FormData();
    form.append("file", file);
    form.append("page_num", String(pageNum));
    form.append("product_id", productId);
    if (options.schemaId) form.append("schema_id", options.schemaId);
    if (options.dynamicColumns)
      form.append("dynamic_columns_json", JSON.stringify(options.dynamicColumns));
    if (options.hint) form.append("hint", options.hint);
    return api.post("/pdf/extract", form, { timeout: 120000 }).then((r) => r.data);
  },
};

export default api;
