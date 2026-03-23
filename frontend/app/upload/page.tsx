"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ingestApi } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import Header from "@/components/layout/Header";
import DropZone from "@/components/upload/DropZone";
import type { DatasetMetadata } from "@/types";
import {
  Loader2, Trash2, Database, RefreshCw, Plus, X,
  CheckCircle2, AlertCircle, Layers, Zap, Lock, ChevronDown, ChevronUp
} from "lucide-react";

const PURPLE = "#a78bfa";
const BLUE = "#60a5fa";
const GREEN = "#4ade80";

function SchemaTypeBadge({ type }: { type?: string | null }) {
  if (!type) return <span style={{ color: "hsl(220 10% 40%)", fontSize: 12 }}>—</span>;
  if (type === "static") return (
    <span style={{ background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)", color: BLUE, fontSize: 11, padding: "2px 8px", borderRadius: 99, fontWeight: 700 }}>
      🔵 Static
    </span>
  );
  return (
    <span style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: GREEN, fontSize: 11, padding: "2px 8px", borderRadius: 99, fontWeight: 700 }}>
      🟢 Dynamic
    </span>
  );
}

function UploadResultCard({ result, onCreateDynamicSchema }: { result: any, onCreateDynamicSchema?: (r: any) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isSuccess = result.status === "success" || result.rows !== undefined;
  const confidence = result.match_confidence ?? 0;
  const mapping = result.column_mapping ?? {};
  const mappingEntries = Object.entries(mapping);

  return (
    <div style={{
      padding: 16, background: "hsl(220 15% 10%)", borderRadius: 12,
      border: `1px solid ${isSuccess ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`,
      marginBottom: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            {isSuccess
              ? <CheckCircle2 size={15} color={GREEN} />
              : <AlertCircle size={15} color="#f87171" />
            }
            <span style={{ fontWeight: 600, fontSize: 14 }}>{result.file_name || result.filename || "File"}</span>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "hsl(220 10% 55%)" }}>{result.rows ?? result.row_count ?? 0} rows</span>
            {result.auto_mapped && result.mapped_to && (
              <>
                <span style={{ color: "hsl(220 10% 35%)" }}>•</span>
                <SchemaTypeBadge type={result.schema_type} />
                <span style={{ fontSize: 12, fontWeight: 600, color: result.schema_type === "static" ? BLUE : GREEN }}>
                  {result.mapped_to}
                </span>
                <span style={{ fontSize: 12, color: "hsl(220 10% 45%)" }}>
                  ({Math.round(confidence * 100)}% confidence)
                </span>
              </>
            )}
            {!result.auto_mapped && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "hsl(220 10% 45%)" }}>Raw (no schema mapped)</span>
                {onCreateDynamicSchema && (
                  <button
                    onClick={() => onCreateDynamicSchema(result)}
                    style={{
                      background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)",
                      color: PURPLE, fontSize: 11, padding: "2px 8px", borderRadius: 6, fontWeight: 600,
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 4
                    }}
                  >
                    <Plus size={12} /> Create Schema
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        {mappingEntries.length > 0 && (
          <button onClick={() => setExpanded(!expanded)} style={{ background: "none", border: "none", cursor: "pointer", color: PURPLE, fontSize: 12, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {mappingEntries.length} columns mapped
          </button>
        )}
      </div>

      {expanded && mappingEntries.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {mappingEntries.map(([src, tgt]: any, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, background: "hsl(220 15% 14%)", borderRadius: 8, padding: "4px 10px", fontSize: 12 }}>
              <code style={{ color: BLUE }}>{src}</code>
              <span style={{ color: "hsl(220 10% 45%)" }}>→</span>
              <code style={{ color: GREEN }}>{tgt as string}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UploadPage() {
  const { productId } = useAppStore();
  const qc = useQueryClient();

  const [files, setFiles] = useState<File[]>([]);
  const [autoMap, setAutoMap] = useState(true);
  const [logicalName, setLogicalName] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<any>(null);

  const createDynamicSchemaMutation = useMutation({
    mutationFn: async (result: any) => {
      let name = result.file_name || result.filename || "Dataset";
      name = name.replace(/\.(xlsx|xls|csv)$/i, "");
      const ld = await ingestApi.createLogicalDataset({
        product_id: productId,
        dataset_name: name,
        description: `Auto-generated schema from ${name}`
      });
      await ingestApi.mapDatasetToLogical(result.dataset_id, ld.id, true);
      return { ld, result };
    },
    onSuccess: (data) => {
      toast.success(`Created & mapped to: ${data.ld.dataset_name}`);
      qc.invalidateQueries({ queryKey: ["datasets", productId] });
      qc.invalidateQueries({ queryKey: ["logical-datasets", productId] });
      setResults(prev => prev.map(r => r.dataset_id === data.result.dataset_id ? {
        ...r, auto_mapped: true, schema_type: "dynamic", mapped_to: data.ld.dataset_name, match_confidence: 1.0
      } : r));
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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => ingestApi.deleteDataset(id),
    onSuccess: () => {
      toast.success("Dataset deleted");
      qc.invalidateQueries({ queryKey: ["datasets", productId] });
    },
    onError: () => toast.error("Failed to delete dataset"),
  });



  const deleteDynamicSchemaMutation = useMutation({
    mutationFn: (id: string) => ingestApi.deleteLogicalDataset(id),
    onSuccess: (_, id) => {
      toast.success("Dynamic schema deleted");
      qc.invalidateQueries({ queryKey: ["logical-datasets", productId] });
      qc.invalidateQueries({ queryKey: ["datasets", productId] });
    },
    onError: () => toast.error("Failed to delete dynamic schema"),
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
                    {autoMap ? <Zap size={14} /> : <AlertCircle size={14} />}
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
              <div className="card-glass">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <Zap size={15} color={PURPLE} />
                  <h3 style={{ fontSize: 14, fontWeight: 600 }}>Upload Results</h3>
                </div>
                {results.map((r: any, i) => (
                  <UploadResultCard 
                    key={i} 
                    result={r} 
                    onCreateDynamicSchema={
                      r.status === "success" && !r.auto_mapped && !createDynamicSchemaMutation.isPending
                        ? (res) => createDynamicSchemaMutation.mutate(res)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}

            {/* Datasets table */}
            <div className="card-glass">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>Ingested Datasets</h3>
                <button onClick={() => refetch()} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(220 10% 55%)", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>

              {loadingDatasets ? (
                <div style={{ textAlign: "center", padding: 40, color: "hsl(220 10% 50%)" }}>
                  <Loader2 size={20} style={{ margin: "0 auto 8px", display: "block" }} /> Loading datasets…
                </div>
              ) : datasets && datasets.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
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
                      {datasets.map((ds: DatasetMetadata & { schema_type?: string }, i) => (
                        <tr key={ds.id || i}>
                          <td style={{ fontWeight: 500 }}>{ds.original_filename}</td>
                          <td><code style={{ fontSize: 12, color: PURPLE }}>{ds.table_name}</code></td>
                          <td>{ds.row_count?.toLocaleString() ?? "—"}</td>
                          <td>{ds.columns?.length ?? "—"}</td>
                          <td><SchemaTypeBadge type={ds.schema_type} /></td>
                          <td>
                            {ds.logical_dataset_name
                              ? <span style={{ fontSize: 12, fontWeight: 600, color: ds.schema_type === "static" ? BLUE : GREEN }}>{ds.logical_dataset_name}</span>
                              : <span style={{ color: "hsl(220 10% 45%)", fontSize: 12 }}>—</span>
                            }
                          </td>
                          <td>
                            <button onClick={() => deleteMutation.mutate(ds.id)} disabled={deleteMutation.isPending} style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                              <Trash2 size={13} /> Delete
                            </button>
                          </td>
                        </tr>
                      ))}
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
              <p style={{ fontSize: 11, color: "hsl(220 10% 50%)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Quick Stats</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "hsl(220 10% 60%)" }}>Physical datasets</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: PURPLE }}>{datasets?.length ?? 0}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "hsl(220 10% 60%)" }}>Dynamic datasets</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{logicalDatasets?.length ?? 0}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "hsl(220 10% 60%)" }}>Product ID</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: BLUE }}>{productId}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
