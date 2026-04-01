"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ingestApi, schemasApi } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import Header from "@/components/layout/Header";
import DropZone from "@/components/upload/DropZone";
import UploadResults from "@/components/upload/UploadResults";
import type { DatasetMetadata } from "@/types";
import {
  Loader2, Trash2, Database, RefreshCw, Plus, X,
  Layers, Zap, Lock
} from "lucide-react";


const PURPLE = "#a78bfa";
const BLUE = "#60a5fa";
const GREEN = "#4ade80";


export default function UploadPage() {
  const { productId } = useAppStore();
  const qc = useQueryClient();

  const [files, setFiles] = useState<File[]>([]);
  const [autoMap, setAutoMap] = useState(true);
  const [logicalName, setLogicalName] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<any>(null);

  // Schema rename modal state
  const [schemaModal, setSchemaModal] = useState<{ datasetId: string; defaultName: string } | null>(null);
  const [schemaModalName, setSchemaModalName] = useState("");
  const [schemaModalColumns, setSchemaModalColumns] = useState<{ display: string; key: string }[]>([]);
  // Set contains normalized_name keys (what the upload table actually uses as column names)
  const [schemaModalSelectedCols, setSchemaModalSelectedCols] = useState<Set<string>>(new Set());
  const [schemaModalColsLoading, setSchemaModalColsLoading] = useState(false);

  const openSchemaModal = async (datasetId: string, defaultName: string) => {
    const cleaned = defaultName.replace(/\.(xlsm|xlsx|xls|csv)(\s*\[.*?\])?$/i, "").trim();
    setSchemaModalName(cleaned);
    setSchemaModalColumns([]);
    setSchemaModalSelectedCols(new Set());
    setSchemaModal({ datasetId, defaultName });
    setSchemaModalColsLoading(true);
    try {
      const ds = await ingestApi.getDataset(datasetId);
      const cols = (ds.columns || []).map((c: any) => {
        if (typeof c === "string") return { display: c, key: c };
        return {
          display: c.column_name || c.normalized_name || String(c),
          key: c.normalized_name || c.column_name || String(c),
        };
      });
      setSchemaModalColumns(cols);
      setSchemaModalSelectedCols(new Set(cols.map(c => c.key)));
    } catch {
      // columns stay empty — user can still create schema without column selection
    } finally {
      setSchemaModalColsLoading(false);
    }
  };

  const createDynamicSchemaMutation = useMutation({
    mutationFn: async ({ datasetId, schemaName, selectedColumns }: { datasetId: string; schemaName: string; selectedColumns: string[] }) => {
      const ld = await ingestApi.createLogicalDataset({
        product_id: productId,
        dataset_name: schemaName,
        description: `Auto-generated schema from ${schemaName}`
      });
      const allSelected = selectedColumns.length === schemaModalColumns.length || selectedColumns.length === 0;
      if (allSelected) {
        await ingestApi.mapDatasetToLogical(datasetId, ld.id, true);
      } else {
        // Keys are normalized_name — matching what the upload table actually uses as column names
        const colMapping = Object.fromEntries(selectedColumns.map(k => [k, k]));
        await ingestApi.mapDatasetToLogical(datasetId, ld.id, false, colMapping);
      }
      return { ld, datasetId };
    },
    onSuccess: (data) => {
      toast.success(`Created & mapped to: ${data.ld.dataset_name}`);
      qc.invalidateQueries({ queryKey: ["datasets", productId] });
      qc.invalidateQueries({ queryKey: ["logical-datasets", productId] });
      setResults(prev => prev.map(r => r.dataset_id === data.datasetId ? {
        ...r, auto_mapped: true, schema_type: "dynamic", mapped_to: data.ld.dataset_name, match_confidence: 1.0
      } : r));
      setSchemaModal(null);
    },
    onError: (err: any) => toast.error(err.message || "Failed to create dynamic schema"),
  });

  const { data: datasets, isLoading: loadingDatasets, refetch } = useQuery({
    queryKey: ["datasets", productId],
    queryFn: () => ingestApi.listDatasets(productId),
    enabled: !!productId,
  });

  const { data: logicalDatasets } = useQuery({
    queryKey: ["logical-datasets", productId],
    queryFn: () => ingestApi.listLogicalDatasets(productId),
    enabled: !!productId,
  });

  const { data: staticSchemas } = useQuery({
    queryKey: ["schemas", productId],
    queryFn: () => schemasApi.list(productId),
    enabled: !!productId,
  });

  // Poll for job status
  const { data: jobStatus } = useQuery({
    queryKey: ["upload-job", jobId],
    queryFn: () => ingestApi.getJobStatus(jobId!),
    enabled: !!jobId && (!activeJob || activeJob.status === "PENDING" || activeJob.status === "PROCESSING"),
    refetchInterval: 2000,
  });

  const uploadMutation = useMutation({
    mutationFn: async (filesToUpload: File[]) => {
      return ingestApi.uploadBulk(filesToUpload, productId, autoMap, logicalName || undefined);
    },
    onSuccess: (data) => {
      setJobId(data.job_id);
      setActiveJob({ status: "PENDING", processed_files: 0, total_files: files.length });
      setFiles([]);
    },
    onError: (err: Error) => toast.error(err.message || "Upload failed. Check your API connection."),
  });

  useEffect(() => {
    if (jobStatus) {
      setActiveJob(jobStatus);
      if (jobStatus.status === "COMPLETED") {
          setResults(jobStatus.results || []);
          toast.success(`Upload complete: ${jobStatus.processed_files} files processed.`);
          qc.invalidateQueries({ queryKey: ["datasets", productId] });
          qc.invalidateQueries({ queryKey: ["logical-datasets", productId] });
          setJobId(null); // Stop polling
      } else if (jobStatus.status === "FAILED") {
          toast.error(`Background processing failed: ${jobStatus.error}`);
          setJobId(null);
      }
    }
  }, [jobStatus, productId, qc]);

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => ingestApi.deleteDataset(id),
    onSuccess: () => {
      toast.success("Dataset deleted");
      qc.invalidateQueries({ queryKey: ["datasets", productId] });
    },
    onError: () => toast.error("Failed to delete dataset"),
  });

  const handleBulkDelete = async () => {
    if (checkedIds.size === 0 || bulkDeleting) return;
    setBulkDeleting(true);
    const ids = Array.from(checkedIds);
    try {
      await Promise.all(ids.map((id) => ingestApi.deleteDataset(id)));
      setCheckedIds(new Set());
      toast.success(`Deleted ${ids.length} dataset${ids.length > 1 ? "s" : ""}`);
      qc.invalidateQueries({ queryKey: ["datasets", productId] });
    } catch {
      toast.error("Some deletions failed");
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleCheck = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allChecked = !!datasets?.length && datasets.every((ds) => checkedIds.has(ds.id));
  const someChecked = !!datasets?.length && datasets.some((ds) => checkedIds.has(ds.id)) && !allChecked;

  const toggleAll = () => {
    if (allChecked) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(datasets?.map((ds) => ds.id) ?? []));
    }
  };



  const deleteDynamicSchemaMutation = useMutation({
    mutationFn: (id: string) => ingestApi.deleteLogicalDataset(id),
    onSuccess: (_, id) => {
      toast.success("Dynamic schema deleted");
      qc.invalidateQueries({ queryKey: ["logical-datasets", productId] });
      qc.invalidateQueries({ queryKey: ["datasets", productId] });
    },
    onError: () => toast.error("Failed to delete dynamic schema"),
  });

  const unmapMutation = useMutation({
    mutationFn: (datasetId: string) => ingestApi.unmapDataset(datasetId),
    onSuccess: (_, datasetId) => {
      toast.success("Schema unmapped — you can now create a new schema for this file.");
      setResults(prev => prev.map(r =>
        r.dataset_id === datasetId
          ? { ...r, auto_mapped: false, schema_type: null, mapped_to: undefined, match_confidence: undefined, column_mapping: undefined }
          : r
      ));
      qc.invalidateQueries({ queryKey: ["datasets", productId] });
      qc.invalidateQueries({ queryKey: ["logical-datasets", productId] });
    },
    onError: () => toast.error("Failed to unmap schema"),
  });

  return (
    <>
      <Header title="Upload" subtitle="Ingest CSV and Excel files into MapLayer" />
      <div className="page-body">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, maxWidth: 1200 }}>
          {/* LEFT — Upload Zone */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="card-glass">
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>File Ingestion</h3>
              <DropZone onFilesAccepted={setFiles} uploading={uploadMutation.isPending} />

              <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>
                    Target Schema (optional)
                  </label>
                  <input
                    value={logicalName}
                    onChange={(e) => setLogicalName(e.target.value)}
                    placeholder="e.g. asset_management"
                    style={{ width: "100%", background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 8, padding: "8px 12px", color: "hsl(220 20% 90%)", fontSize: 13, outline: "none" }}
                  />
                  <p style={{ fontSize: 10, color: "hsl(220 10% 40%)", marginTop: 4 }}>
                    Leave blank — AI auto-detects the best schema
                  </p>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>
                    AI Auto-Map
                  </label>
                  <button
                    onClick={() => setAutoMap(!autoMap)}
                    style={{
                      padding: "8px 16px", borderRadius: 8, fontWeight: 600, fontSize: 13,
                      cursor: "pointer", border: "1px solid",
                      background: autoMap ? "rgba(167,139,250,0.15)" : "hsl(220 15% 12%)",
                      borderColor: autoMap ? "rgba(167,139,250,0.4)" : "hsl(220 15% 22%)",
                      color: autoMap ? "#a78bfa" : "hsl(220 10% 55%)",
                      display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
                    }}
                  >
                    {autoMap ? <Zap size={14} /> : <Zap size={14} style={{ opacity: 0.4 }} />}
                    {autoMap ? "Enabled" : "Disabled"}
                  </button>
                </div>
                <button
                  className="btn-gradient"
                  onClick={() => files.length > 0 && uploadMutation.mutate(files)}
                  disabled={files.length === 0 || uploadMutation.isPending}
                  style={{ padding: "8px 20px", display: "flex", alignItems: "center", gap: 8, height: 38 }}
                >
                  {uploadMutation.isPending ? (
                    <><Loader2 size={14} className="spin" /> Uploading…</>
                  ) : (
                    <>Upload {files.length > 1 ? `${files.length} Files` : "File"}</>
                  )}
                </button>
               </div>
            </div>

            {/* Background Job Progress */}
            {activeJob && (activeJob.status === "PENDING" || activeJob.status === "PROCESSING") && (
              <div className="card-glass" style={{ marginBottom: 20, border: `1px solid ${PURPLE}44` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Loader2 size={16} className="spin" color={PURPLE} />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {activeJob.status === "PENDING" ? "Queueing files..." : "AI Processing Data..."}
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(220 20% 90%)" }}>
                      {activeJob.processed_files} / {activeJob.total_files} files
                    </div>
                  </div>
                </div>
                <div style={{ width: "100%", height: 8, background: "hsl(220 15% 15%)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ 
                        width: `${Math.min(100, (activeJob.processed_files / (activeJob.total_files || 1)) * 100)}%`, 
                        height: "100%", 
                        background: `linear-gradient(90deg, ${PURPLE}, ${BLUE})`,
                        transition: "width 0.5s ease-out" 
                    }} />
                </div>
              </div>
            )}

            {/* Upload result cards */}
            {results.length > 0 && (
              <UploadResults
                results={results}
                isPending={createDynamicSchemaMutation.isPending || unmapMutation.isPending}
                onCreateSchema={(r) => openSchemaModal(r.dataset_id!, r.file_name || r.filename || "Dataset")}
                onUnmap={(r) => r.dataset_id && unmapMutation.mutate(r.dataset_id)}
              />
            )}

            {/* Datasets table */}
            <div className="card-glass">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: checkedIds.size > 0 ? 10 : 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>Ingested Datasets</h3>
                <button onClick={() => refetch()} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(220 10% 55%)", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>

              {/* Bulk delete floating bar */}
              {checkedIds.size > 0 && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 16px", marginBottom: 16, borderRadius: 12,
                  background: "linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.05))",
                  border: "1px solid rgba(239,68,68,0.3)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                  animation: "fadeIn 0.2s ease-out",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(239,68,68,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Trash2 size={16} color="#f87171" />
                    </div>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#f87171", display: "block" }}>
                        Bulk Actions
                      </span>
                      <span style={{ fontSize: 11, color: "hsl(220 10% 55%)" }}>
                        {checkedIds.size} file{checkedIds.size > 1 ? "s" : ""} selected for deletion
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setCheckedIds(new Set())}
                      style={{
                        padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                        background: "transparent", border: "1px solid hsl(220 15% 22%)",
                        cursor: "pointer", color: "hsl(220 10% 60%)",
                        display: "flex", alignItems: "center", gap: 6,
                      }}
                    >
                      <X size={14} /> Clear Selection
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      disabled={bulkDeleting}
                      style={{
                        display: "flex", alignItems: "center", gap: 6, padding: "6px 16px",
                        borderRadius: 8, border: "none",
                        background: "#ef4444", color: "white",
                        cursor: bulkDeleting ? "not-allowed" : "pointer",
                        fontSize: 12, fontWeight: 700, opacity: bulkDeleting ? 0.6 : 1,
                        boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                      }}
                    >
                      {bulkDeleting
                        ? <><Loader2 size={14} className="spin" /> Deleting…</>
                        : <><Trash2 size={14} /> Delete Selected</>
                      }
                    </button>
                  </div>
                </div>
              )}

              {loadingDatasets ? (
                <div style={{ textAlign: "center", padding: 40, color: "hsl(220 10% 50%)" }}>
                  <Loader2 size={20} style={{ margin: "0 auto 8px", display: "block" }} /> Loading datasets…
                </div>
              ) : datasets && datasets.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 44, paddingRight: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <input
                              type="checkbox"
                              checked={allChecked}
                              ref={(el) => { if (el) el.indeterminate = someChecked; }}
                              onChange={toggleAll}
                              style={{
                                cursor: "pointer", width: 16, height: 16,
                                accentColor: "#f87171",
                              }}
                            />
                          </div>
                        </th>
                        <th>Filename</th>
                        <th>Table</th>
                        <th>Rows</th>
                        <th>Columns</th>
                        <th>Schema Type</th>
                        <th>Mapped To</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datasets.map((ds: DatasetMetadata & { schema_type?: string }, i) => {
                        const isChecked = checkedIds.has(ds.id);
                        return (
                          <tr
                            key={ds.id || i}
                            style={{ background: isChecked ? "rgba(239,68,68,0.05)" : undefined }}
                          >
                            <td style={{ paddingRight: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleCheck(ds.id)}
                                  style={{
                                    cursor: "pointer", width: 16, height: 16,
                                    accentColor: "#f87171",
                                  }}
                                />
                              </div>
                            </td>
                            <td style={{ fontWeight: 500 }}>{ds.original_filename}</td>
                            <td><code style={{ fontSize: 12, color: PURPLE }}>{ds.table_name}</code></td>
                            <td>{ds.row_count?.toLocaleString() ?? "—"}</td>
                            <td>{ds.columns?.length ?? "—"}</td>
                            <td>
                              {!ds.schema_type
                                ? <span style={{ color: "hsl(220 10% 40%)", fontSize: 12 }}>—</span>
                                : ds.schema_type === "static"
                                  ? <span style={{ background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)", color: BLUE, fontSize: 11, padding: "2px 8px", borderRadius: 99, fontWeight: 700 }}>🔵 Static</span>
                                  : <span style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: GREEN, fontSize: 11, padding: "2px 8px", borderRadius: 99, fontWeight: 700 }}>🟢 Dynamic</span>
                              }
                            </td>
                            <td>
                              {ds.logical_dataset_name
                                ? <span style={{ fontSize: 12, fontWeight: 600, color: ds.schema_type === "static" ? BLUE : GREEN }}>{ds.logical_dataset_name}</span>
                                : <span style={{ color: "hsl(220 10% 45%)", fontSize: 12 }}>—</span>
                              }
                            </td>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {!ds.logical_dataset_name && (
                                  <button
                                    onClick={() => openSchemaModal(ds.id, ds.original_filename || "Dataset")}
                                    style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 6, cursor: "pointer", color: PURPLE, display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: "3px 8px", fontWeight: 600 }}
                                  >
                                    <Plus size={11} /> Schema
                                  </button>
                                )}
                                <button
                                  onClick={() => deleteMutation.mutate(ds.id)}
                                  disabled={deleteMutation.isPending || bulkDeleting}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
                                >
                                  <Trash2 size={13} /> Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "hsl(220 10% 45%)" }}>
                  <Database size={32} style={{ margin: "0 auto 10px", opacity: 0.4, display: "block" }} />
                  <p style={{ fontSize: 14 }}>No datasets yet. Upload a file to get started.</p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — Schemas panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card-glass">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Lock size={14} color={BLUE} />
                <h3 style={{ fontSize: 14, fontWeight: 600 }}>Static Schemas</h3>
              </div>
              <p style={{ fontSize: 11, color: "hsl(220 10% 45%)", marginBottom: 10, lineHeight: 1.5 }}>
                Predefined production contracts. AI prefers these for strict matching.
              </p>
              <p style={{ fontSize: 12, color: "hsl(220 10% 50%)", fontStyle: "italic" }}>
                Manage static schemas on the Mapping page →
              </p>
            </div>

            <div className="card-glass">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Layers size={14} color={GREEN} />
                  <h3 style={{ fontSize: 14, fontWeight: 600 }}>Dynamic Datasets</h3>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {logicalDatasets && logicalDatasets.length > 0 ? (
                  logicalDatasets.map((ld, i) => (
                    <div
                      key={ld.id || i}
                      className="dynamic-schema-card"
                      style={{ padding: "10px 12px", background: "hsl(220 15% 10%)", borderRadius: 10, border: "1px solid hsl(220 15% 18%)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Layers size={13} color={GREEN} />
                          <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ld.dataset_name}</span>
                        </div>
                        {ld.description && <p style={{ fontSize: 11, color: "hsl(220 10% 50%)", marginTop: 3, paddingLeft: 21 }}>{ld.description}</p>}
                      </div>
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${ld.dataset_name}"? This also removes its analytics table.`)) {
                            deleteDynamicSchemaMutation.mutate(ld.id);
                          }
                        }}
                        disabled={deleteDynamicSchemaMutation.isPending}
                        title="Delete schema"
                        style={{
                          flexShrink: 0, background: "none", border: "none",
                          cursor: "pointer", color: "#f87171", padding: 4,
                          opacity: 0.45, transition: "opacity 0.15s", borderRadius: 6,
                          display: "flex", alignItems: "center",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.45")}
                      >
                        {deleteDynamicSchemaMutation.isPending
                          ? <Loader2 size={13} className="spin" />
                          : <Trash2 size={13} />
                        }
                      </button>
                    </div>
                  ))
                ) : (
                  <p style={{ fontSize: 13, color: "hsl(220 10% 45%)", textAlign: "center", padding: "20px 0" }}>No dynamic schemas yet</p>
                )}
              </div>
            </div>

            <div className="stat-card">
              <p style={{ fontSize: 11, color: "hsl(220 10% 50%)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Quick Stats</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {[
                  { label: "Total files", value: datasets?.length ?? 0, color: PURPLE },
                  { label: "Static schemas", value: staticSchemas?.length ?? 0, color: BLUE },
                  { label: "Dynamic schemas", value: logicalDatasets?.length ?? 0, color: GREEN },
                  { label: "Unmapped files", value: (datasets ?? []).filter((d: any) => !d.logical_dataset_name).length, color: "#f87171" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid hsl(220 15% 16%)" }}>
                    <span style={{ fontSize: 13, color: "hsl(220 10% 60%)" }}>{label}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8 }}>
                  <span style={{ fontSize: 12, color: "hsl(220 10% 50%)" }}>Product</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: BLUE }}>{productId}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Schema create modal */}
      {schemaModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
          onClick={() => setSchemaModal(null)}
        >
          <div
            style={{
              background: "hsl(220 15% 13%)", border: "1px solid hsl(220 15% 25%)",
              borderRadius: 14, padding: 28, width: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              maxHeight: "90vh", overflowY: "auto",
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Create Dynamic Schema</h3>
            <p style={{ fontSize: 12, color: "hsl(220 10% 50%)", marginBottom: 18 }}>
              Name the schema and choose which columns to include.
            </p>

            <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>
              Schema Name
            </label>
            <input
              autoFocus
              value={schemaModalName}
              onChange={e => setSchemaModalName(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") setSchemaModal(null); }}
              placeholder="e.g. vendor_quotes"
              style={{
                width: "100%", background: "hsl(220 15% 10%)",
                border: "1px solid hsl(220 15% 25%)", borderRadius: 8,
                padding: "9px 12px", color: "hsl(220 20% 92%)", fontSize: 13,
                outline: "none", marginBottom: 18, boxSizing: "border-box",
              }}
            />

            {/* Column selection */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Columns
                  {!schemaModalColsLoading && schemaModalColumns.length > 0 && (
                    <span style={{ marginLeft: 6, color: PURPLE, fontWeight: 700 }}>
                      {schemaModalSelectedCols.size}/{schemaModalColumns.length} selected
                    </span>
                  )}
                </label>
                {!schemaModalColsLoading && schemaModalColumns.length > 0 && (
                  <button
                    onClick={() => {
                      if (schemaModalSelectedCols.size === schemaModalColumns.length) {
                        setSchemaModalSelectedCols(new Set());
                      } else {
                        setSchemaModalSelectedCols(new Set(schemaModalColumns.map(c => c.key)));
                      }
                    }}
                    style={{ fontSize: 11, color: PURPLE, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {schemaModalSelectedCols.size === schemaModalColumns.length ? "Deselect all" : "Select all"}
                  </button>
                )}
              </div>

              {schemaModalColsLoading ? (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 60, gap: 8, color: "hsl(220 10% 50%)", fontSize: 13 }}>
                  <Loader2 size={15} className="spin" /> Loading columns…
                </div>
              ) : schemaModalColumns.length === 0 ? (
                <p style={{ fontSize: 12, color: "hsl(220 10% 45%)", textAlign: "center", padding: "10px 0" }}>
                  No column info available — all columns will be included.
                </p>
              ) : (
                <div style={{
                  maxHeight: 220, overflowY: "auto",
                  background: "hsl(220 15% 10%)", borderRadius: 8,
                  border: "1px solid hsl(220 15% 20%)", padding: "4px 0",
                }}>
                  {schemaModalColumns.map(col => {
                    const checked = schemaModalSelectedCols.has(col.key);
                    return (
                      <div
                        key={col.key}
                        onClick={() => setSchemaModalSelectedCols(prev => {
                          const next = new Set(prev);
                          next.has(col.key) ? next.delete(col.key) : next.add(col.key);
                          return next;
                        })}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "6px 12px", cursor: "pointer",
                          background: checked ? "rgba(167,139,250,0.06)" : "transparent",
                          transition: "background 0.1s",
                        }}
                      >
                        <div style={{
                          width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                          border: `1.5px solid ${checked ? PURPLE : "hsl(220 15% 30%)"}`,
                          background: checked ? `${PURPLE}33` : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {checked && <div style={{ width: 8, height: 8, background: PURPLE, borderRadius: 1 }} />}
                        </div>
                        <span style={{
                          fontSize: 12, fontFamily: "monospace",
                          color: checked ? "hsl(220 20% 88%)" : "hsl(220 10% 55%)",
                        }}>
                          {col.display}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setSchemaModal(null)}
                style={{ padding: "7px 16px", borderRadius: 8, fontSize: 13, background: "transparent", border: "1px solid hsl(220 15% 22%)", cursor: "pointer", color: "hsl(220 10% 60%)" }}
              >
                Cancel
              </button>
              <button
                className="btn-gradient"
                onClick={() => createDynamicSchemaMutation.mutate({
                  datasetId: schemaModal.datasetId,
                  schemaName: schemaModalName.trim(),
                  selectedColumns: Array.from(schemaModalSelectedCols),
                })}
                disabled={!schemaModalName.trim() || createDynamicSchemaMutation.isPending || schemaModalSelectedCols.size === 0}
                style={{ padding: "7px 20px", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
              >
                {createDynamicSchemaMutation.isPending ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                Create Schema
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
