"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ingestApi, pdfApi } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import Header from "@/components/layout/Header";
import DropZone from "@/components/upload/DropZone";
import UploadResults from "@/components/upload/UploadResults";
import type { DatasetMetadata, PdfAnalyzeResponse } from "@/types";
import {
  Loader2, Trash2, Database, RefreshCw, Plus, X,
  Layers, Lock, Eye, FileText, ChevronRight, ChevronLeft,
  Sparkles, Search, Unlink,
} from "lucide-react";


const PURPLE = "#a78bfa";
const BLUE = "#60a5fa";
const GREEN = "#4ade80";

function formatRelativeTime(dateStr: string): string {
  // Append Z if no timezone info so the string is treated as UTC, not local time
  const normalized =
    dateStr.endsWith("Z") || dateStr.includes("+") || dateStr.includes("-", 10)
      ? dateStr
      : dateStr + "Z";
  const date = new Date(normalized);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export default function UploadPage() {
  const { productId } = useAppStore();
  const qc = useQueryClient();
  const router = useRouter();

  const [excelFiles, setExcelFiles] = useState<File[]>([]);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>("");

  // PDF extraction state
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pdfFileIdx, setPdfFileIdx] = useState(0);
  const [pdfPageNum, setPdfPageNum] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(1);
  const [pdfPreviewB64, setPdfPreviewB64] = useState<string | null>(null);
  const [pdfLoadingPreview, setPdfLoadingPreview] = useState(false);
  const [pdfSchemaId, setPdfSchemaId] = useState("");
  const [pdfHint, setPdfHint] = useState("");
  const [pdfAnalysis, setPdfAnalysis] = useState<PdfAnalyzeResponse | null>(null);
  const [pdfAnalyzing, setPdfAnalyzing] = useState(false);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<any>(null);

  // Schema create modal state
  const [schemaModal, setSchemaModal] = useState<{ datasetId: string; defaultName: string } | null>(null);
  const [schemaModalName, setSchemaModalName] = useState("");
  const [schemaModalColumns, setSchemaModalColumns] = useState<{ display: string; key: string }[]>([]);
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
      setSchemaModalSelectedCols(new Set(cols.map((c: any) => c.key)));
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
    enabled: !!productId && !activeJob,
    refetchOnWindowFocus: false,
  });

  const { data: logicalDatasets } = useQuery({
    queryKey: ["logical-datasets", productId],
    queryFn: () => ingestApi.listLogicalDatasets(productId),
    enabled: !!productId,
  });

  const { data: allSchemas, isLoading: loadingSchemas } = useQuery({
    queryKey: ["all-schemas", productId],
    queryFn: () => ingestApi.listAllSchemas(productId),
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
      return ingestApi.uploadBulk(filesToUpload, productId, true);
    },
    onSuccess: (data) => {
      setJobId(data.job_id);
      setActiveJob({ status: "PENDING", processed_files: 0, total_files: excelFiles.length });
      setExcelFiles([]);
    },
    onError: (err: Error) => toast.error(err.message || "Upload failed. Check your API connection."),
  });

  useEffect(() => {
    if (jobStatus) {
      setActiveJob(jobStatus);
      if (jobStatus.status === "COMPLETED") {
        setResults(jobStatus.results || []);
        toast.success(`Upload complete: ${jobStatus.processed_files} files processed.`);
        setJobId(null);
        setActiveJob(null);

        // If a specific schema was selected, remap all successful uploads to it
        if (selectedSchemaId) {
          const successfulResults = (jobStatus.results || []).filter(
            (r: any) => r.status === "success" && r.dataset_id
          );
          if (successfulResults.length > 0) {
            Promise.all(
              successfulResults.map((r: any) =>
                ingestApi.mapDatasetToLogical(r.dataset_id, selectedSchemaId, true).catch(() => {})
              )
            ).then(() => {
              qc.invalidateQueries({ queryKey: ["datasets", productId] });
              qc.invalidateQueries({ queryKey: ["logical-datasets", productId] });
            });
          } else {
            qc.invalidateQueries({ queryKey: ["datasets", productId] });
            qc.invalidateQueries({ queryKey: ["logical-datasets", productId] });
          }
        } else {
          qc.invalidateQueries({ queryKey: ["datasets", productId] });
          qc.invalidateQueries({ queryKey: ["logical-datasets", productId] });
        }
      } else if (jobStatus.status === "FAILED") {
        toast.error(`Background processing failed: ${jobStatus.error}`);
        setJobId(null);
        setActiveJob(null);
      }
    }
  }, [jobStatus, productId, qc, selectedSchemaId]);

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
    onSuccess: () => {
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

  const staticSchemasCount = allSchemas?.filter(s => s.schema_type === "static" || !s.schema_type).length ?? 0;

  /* ── PDF helpers ── */
  const removePdf = (idx: number) => {
    setPdfFiles(prev => prev.filter((_, i) => i !== idx));
    const nextIdx = idx < pdfFileIdx ? pdfFileIdx - 1 : Math.min(pdfFileIdx, pdfFiles.length - 2);
    setPdfFileIdx(Math.max(0, nextIdx));
    setPdfPreviewB64(null);
    setPdfAnalysis(null);
    setPdfPageNum(1);
    setPdfPageCount(1);
  };

  const loadPdfPreview = async (file: File, page: number) => {
    setPdfLoadingPreview(true);
    try {
      const res = await pdfApi.previewPage(file, page);
      setPdfPreviewB64(res.page_image_b64);
      setPdfPageCount(res.page_count);
    } catch (e: any) {
      toast.error(e.message || "Failed to render PDF page");
    } finally {
      setPdfLoadingPreview(false);
    }
  };

  const navigatePdfPage = (delta: number) => {
    const newPage = pdfPageNum + delta;
    if (newPage < 1 || newPage > pdfPageCount) return;
    setPdfPageNum(newPage);
    setPdfPreviewB64(null);
    setPdfAnalysis(null);
    loadPdfPreview(pdfFiles[pdfFileIdx], newPage);
  };

  const runPdfAnalyze = async () => {
    const file = pdfFiles[pdfFileIdx];
    if (!file) return;
    setPdfAnalyzing(true);
    try {
      const res = await pdfApi.analyzeTable(file, pdfPageNum, productId);
      setPdfAnalysis(res);
      if (res.best_match) {
        setPdfSchemaId(res.best_match.schema_id);
        toast.success(`Matched "${res.best_match.schema_name}" — ${Math.round(res.best_match.confidence * 100)}% confidence`);
      } else {
        toast.info(`${res.detected_columns?.length ?? 0} columns detected`);
      }
    } catch (e: any) {
      toast.error(e.message || "Analysis failed");
    } finally {
      setPdfAnalyzing(false);
    }
  };

  const runPdfExtract = async () => {
    const file = pdfFiles[pdfFileIdx];
    if (!file) return;
    setPdfExtracting(true);
    try {
      const res = await pdfApi.extractData(file, pdfPageNum, productId, {
        schemaId: pdfSchemaId || undefined,
        hint: pdfHint || undefined,
      });
      toast.success(`Extracted ${res.row_count} rows from page ${pdfPageNum}`);
      qc.invalidateQueries({ queryKey: ["datasets", productId] });
      removePdf(pdfFileIdx);
    } catch (e: any) {
      toast.error(e.message || "Extraction failed");
    } finally {
      setPdfExtracting(false);
    }
  };

  return (
    <>
      <Header title="Analysis" subtitle="Ingest CSV and Excel files into MapLayer" />
      <div className="page-body">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, maxWidth: 1200 }}>
          {/* LEFT — Upload Zone */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="card-glass">
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>File Ingestion</h3>
              <DropZone
                onFilesAccepted={(incoming) => {
                  const pdfs = incoming.filter(f => f.name.toLowerCase().endsWith(".pdf"));
                  const excels = incoming.filter(f => !f.name.toLowerCase().endsWith(".pdf"));
                  if (pdfs.length > 0) {
                    setPdfFiles(prev => [...prev, ...pdfs]);
                    setPdfPreviewB64(null);
                    setPdfAnalysis(null);
                  }
                  if (excels.length > 0) setExcelFiles(excels);
                }}
                uploading={uploadMutation.isPending}
              />

              <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
                {/* Schema picker dropdown */}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>
                    Target Schema
                  </label>
                  <div style={{ position: "relative" }}>
                    <select
                      value={selectedSchemaId}
                      onChange={(e) => setSelectedSchemaId(e.target.value)}
                      style={{
                        width: "100%", background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                        borderRadius: 8, padding: "8px 32px 8px 12px", color: selectedSchemaId ? "hsl(220 20% 90%)" : "hsl(220 10% 45%)",
                        fontSize: 13, outline: "none", appearance: "none", cursor: "pointer",
                      }}
                    >
                      <option value="">Auto-detect (AI)</option>
                      {loadingSchemas ? (
                        <option disabled>Loading schemas…</option>
                      ) : (
                        allSchemas?.map((s) => (
                          <option key={String(s.id)} value={String(s.id)}>
                            {s.schema_name}{s.schema_type === "dynamic" ? " (dynamic)" : ""}
                          </option>
                        ))
                      )}
                    </select>
                    <ChevronRight size={12} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%) rotate(90deg)", color: "hsl(220 10% 45%)", pointerEvents: "none" }} />
                  </div>
                  <p style={{ fontSize: 10, color: "hsl(220 10% 40%)", marginTop: 4 }}>
                    {selectedSchemaId ? "Files will be mapped to the selected schema after upload" : "AI auto-detects the best matching schema"}
                  </p>
                </div>

                <button
                  className="btn-gradient"
                  onClick={() => excelFiles.length > 0 && uploadMutation.mutate(excelFiles)}
                  disabled={excelFiles.length === 0 || uploadMutation.isPending}
                  style={{ padding: "8px 20px", display: "flex", alignItems: "center", gap: 8, height: 38 }}
                >
                  {uploadMutation.isPending ? (
                    <><Loader2 size={14} className="spin" /> Uploading…</>
                  ) : (
                    <>Upload {excelFiles.length > 1 ? `${excelFiles.length} Files` : "File"}</>
                  )}
                </button>
              </div>
            </div>

            {/* ── Inline PDF Extraction Panel ── */}
            {pdfFiles.length > 0 && (
              <div className="card-glass" style={{ border: `1px solid ${PURPLE}33` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <FileText size={15} color={PURPLE} />
                  <h3 style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>PDF Extraction</h3>
                  <span style={{ fontSize: 11, color: "hsl(220 10% 50%)" }}>{pdfFiles.length} file{pdfFiles.length > 1 ? "s" : ""}</span>
                </div>

                {/* File tabs */}
                {pdfFiles.length > 1 && (
                  <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
                    {pdfFiles.map((f, i) => (
                      <button
                        key={i}
                        onClick={() => { if (i !== pdfFileIdx) { setPdfFileIdx(i); setPdfPageNum(1); setPdfPreviewB64(null); setPdfAnalysis(null); } }}
                        style={{
                          display: "flex", alignItems: "center", gap: 5, padding: "4px 10px",
                          borderRadius: 7, border: "1px solid", fontSize: 11, fontWeight: 600, cursor: "pointer",
                          background: i === pdfFileIdx ? `${PURPLE}18` : "transparent",
                          borderColor: i === pdfFileIdx ? `${PURPLE}55` : "hsl(220 15% 22%)",
                          color: i === pdfFileIdx ? PURPLE : "hsl(220 10% 50%)",
                        }}
                      >
                        {f.name.length > 22 ? f.name.slice(0, 22) + "…" : f.name}
                        <span
                          onClick={(e) => { e.stopPropagation(); removePdf(i); }}
                          style={{ display: "flex", alignItems: "center", cursor: "pointer", opacity: 0.6 }}
                        >
                          <X size={10} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
                  {/* Page Preview */}
                  <div style={{ flex: "1 1 240px", minWidth: 200 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(220 20% 80%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                        {pdfFiles[pdfFileIdx]?.name}
                      </span>
                      {pdfFiles.length === 1 && (
                        <button onClick={() => removePdf(0)} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(220 10% 45%)", display: "flex", alignItems: "center" }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {pdfPreviewB64 ? (
                      <img
                        src={`data:image/png;base64,${pdfPreviewB64}`}
                        alt="PDF page preview"
                        style={{ width: "100%", borderRadius: 8, border: "1px solid hsl(220 15% 20%)", display: "block" }}
                      />
                    ) : (
                      <div style={{ width: "100%", minHeight: 160, borderRadius: 8, border: "1px dashed hsl(220 15% 22%)", display: "flex", alignItems: "center", justifyContent: "center", background: "hsl(220 15% 8%)" }}>
                        <button
                          onClick={() => loadPdfPreview(pdfFiles[pdfFileIdx], pdfPageNum)}
                          disabled={pdfLoadingPreview}
                          className="btn-gradient"
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", fontSize: 12 }}
                        >
                          {pdfLoadingPreview ? <><Loader2 size={13} className="spin" /> Loading…</> : <><Eye size={13} /> Preview Page</>}
                        </button>
                      </div>
                    )}

                    {/* Page navigation */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, justifyContent: "center" }}>
                      <button
                        onClick={() => navigatePdfPage(-1)}
                        disabled={pdfPageNum <= 1 || pdfLoadingPreview}
                        style={{ background: "hsl(220 15% 14%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: pdfPageNum <= 1 ? "hsl(220 10% 35%)" : "hsl(220 20% 80%)", fontSize: 13, display: "flex", alignItems: "center" }}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <input
                          type="number"
                          min={1}
                          max={pdfPageCount}
                          value={pdfPageNum}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val >= 1 && val <= pdfPageCount) setPdfPageNum(val);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const val = parseInt((e.target as HTMLInputElement).value, 10);
                              if (!isNaN(val) && val >= 1 && val <= pdfPageCount) {
                                setPdfPreviewB64(null);
                                setPdfAnalysis(null);
                                loadPdfPreview(pdfFiles[pdfFileIdx], val);
                              }
                            }
                          }}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val >= 1 && val <= pdfPageCount && val !== pdfPageNum) {
                              setPdfPreviewB64(null);
                              setPdfAnalysis(null);
                              loadPdfPreview(pdfFiles[pdfFileIdx], val);
                            }
                          }}
                          disabled={pdfLoadingPreview}
                          style={{
                            width: 48, textAlign: "center", background: "hsl(220 15% 12%)",
                            border: "1px solid hsl(220 15% 25%)", borderRadius: 6,
                            padding: "3px 6px", color: "hsl(220 20% 88%)", fontSize: 12,
                            outline: "none", MozAppearance: "textfield",
                          } as React.CSSProperties}
                        />
                        <span style={{ fontSize: 11, color: "hsl(220 10% 45%)" }}>/ {pdfPageCount}</span>
                      </div>
                      <button
                        onClick={() => navigatePdfPage(1)}
                        disabled={pdfPageNum >= pdfPageCount || pdfLoadingPreview}
                        style={{ background: "hsl(220 15% 14%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: pdfPageNum >= pdfPageCount ? "hsl(220 10% 35%)" : "hsl(220 20% 80%)", fontSize: 13, display: "flex", alignItems: "center" }}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Config + Actions */}
                  <div style={{ flex: "1 1 200px", minWidth: 200, display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* Schema picker */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>
                        Target Schema
                      </label>
                      <div style={{ position: "relative" }}>
                        <select
                          value={pdfSchemaId}
                          onChange={(e) => setPdfSchemaId(e.target.value)}
                          style={{ width: "100%", background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 8, padding: "7px 28px 7px 10px", color: pdfSchemaId ? "hsl(220 20% 90%)" : "hsl(220 10% 45%)", fontSize: 12, outline: "none", appearance: "none", cursor: "pointer" }}
                        >
                          <option value="">Auto-detect (AI)</option>
                          {allSchemas?.map((s) => (
                            <option key={String(s.id)} value={String(s.id)}>
                              {s.schema_name}{s.schema_type === "dynamic" ? " (dynamic)" : ""}
                            </option>
                          ))}
                        </select>
                        <ChevronRight size={11} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%) rotate(90deg)", color: "hsl(220 10% 45%)", pointerEvents: "none" }} />
                      </div>
                    </div>

                    {/* Hint */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>
                        Hint <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
                      </label>
                      <input
                        value={pdfHint}
                        onChange={(e) => setPdfHint(e.target.value)}
                        placeholder="e.g. Focus on the price table in the middle"
                        style={{ width: "100%", background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 8, padding: "7px 10px", color: "hsl(220 20% 90%)", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                      />
                    </div>

                    {/* Analyze */}
                    <button
                      onClick={runPdfAnalyze}
                      disabled={!pdfPreviewB64 || pdfAnalyzing}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: `1px solid ${PURPLE}44`, background: `${PURPLE}10`, color: PURPLE, cursor: (!pdfPreviewB64 || pdfAnalyzing) ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600, opacity: (!pdfPreviewB64 || pdfAnalyzing) ? 0.5 : 1 }}
                    >
                      {pdfAnalyzing ? <><Loader2 size={12} className="spin" /> Analyzing…</> : <><Search size={12} /> Analyze Table</>}
                    </button>

                    {/* Analysis results */}
                    {pdfAnalysis && (
                      <div style={{ padding: "10px 12px", borderRadius: 8, background: "hsl(220 15% 10%)", border: "1px solid hsl(220 15% 18%)" }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", marginBottom: 6 }}>
                          <Sparkles size={11} style={{ display: "inline", marginRight: 4 }} />
                          {pdfAnalysis.detected_columns?.length ?? 0} columns detected
                          {pdfAnalysis.best_match && ` · matched "${pdfAnalysis.best_match.schema_name}"`}
                        </p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {(pdfAnalysis.detected_columns ?? []).slice(0, 8).map((col: any, i: number) => (
                            <span key={i} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, background: `${BLUE}15`, border: `1px solid ${BLUE}30`, color: BLUE }}>
                              {col.detected_header || col.suggested_key}
                            </span>
                          ))}
                          {(pdfAnalysis.detected_columns?.length ?? 0) > 8 && (
                            <span style={{ fontSize: 10, color: "hsl(220 10% 45%)" }}>+{(pdfAnalysis.detected_columns?.length ?? 0) - 8} more</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Extract & Save */}
                    <button
                      className="btn-gradient"
                      onClick={runPdfExtract}
                      disabled={pdfExtracting || !pdfPreviewB64}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 12, fontWeight: 700, opacity: (pdfExtracting || !pdfPreviewB64) ? 0.5 : 1 }}
                    >
                      {pdfExtracting ? <><Loader2 size={13} className="spin" /> Extracting…</> : <><Sparkles size={13} /> Extract & Save</>}
                    </button>
                  </div>
                </div>
              </div>
            )}

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

            {/* Upload History list */}
            <div className="card-glass">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: checkedIds.size > 0 ? 10 : 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>Upload History</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {datasets && datasets.length > 0 && (
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "hsl(220 10% 55%)" }}>
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => { if (el) el.indeterminate = someChecked; }}
                        onChange={toggleAll}
                        style={{ cursor: "pointer", accentColor: "#f87171" }}
                      />
                      Select all
                    </label>
                  )}
                  <button onClick={() => refetch()} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(220 10% 55%)", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <RefreshCw size={13} /> Refresh
                  </button>
                </div>
              </div>

              {/* Bulk delete floating bar */}
              {checkedIds.size > 0 && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 16px", marginBottom: 16, borderRadius: 12,
                  background: "linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.05))",
                  border: "1px solid rgba(239,68,68,0.3)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(239,68,68,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Trash2 size={16} color="#f87171" />
                    </div>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#f87171", display: "block" }}>Bulk Actions</span>
                      <span style={{ fontSize: 11, color: "hsl(220 10% 55%)" }}>
                        {checkedIds.size} file{checkedIds.size > 1 ? "s" : ""} selected
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setCheckedIds(new Set())}
                      style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "transparent", border: "1px solid hsl(220 15% 22%)", cursor: "pointer", color: "hsl(220 10% 60%)", display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <X size={14} /> Clear
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      disabled={bulkDeleting}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 8, border: "none", background: "#ef4444", color: "white", cursor: bulkDeleting ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, opacity: bulkDeleting ? 0.6 : 1 }}
                    >
                      {bulkDeleting ? <><Loader2 size={14} className="spin" /> Deleting…</> : <><Trash2 size={14} /> Delete Selected</>}
                    </button>
                  </div>
                </div>
              )}

              {loadingDatasets ? (
                <div style={{ textAlign: "center", padding: 40, color: "hsl(220 10% 50%)" }}>
                  <Loader2 size={20} style={{ margin: "0 auto 8px", display: "block" }} /> Loading history…
                </div>
              ) : datasets && datasets.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {datasets.map((ds: DatasetMetadata & { schema_type?: string }, i) => {
                    const isChecked = checkedIds.has(ds.id);
                    const schemaColor = ds.schema_type === "static" ? BLUE : ds.schema_type === "dynamic" ? GREEN : "hsl(220 10% 40%)";
                    return (
                      <div
                        key={ds.id || i}
                        style={{
                          padding: "14px 16px", borderRadius: 12, border: "1px solid",
                          background: isChecked ? "rgba(239,68,68,0.04)" : "hsl(220 15% 10%)",
                          borderColor: isChecked ? "rgba(239,68,68,0.25)" : "hsl(220 15% 18%)",
                          transition: "all 0.12s",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                          {/* Checkbox */}
                          <div style={{ paddingTop: 2 }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleCheck(ds.id)}
                              style={{ cursor: "pointer", width: 15, height: 15, accentColor: "#f87171" }}
                            />
                          </div>

                          {/* File icon */}
                          <div style={{ width: 36, height: 36, borderRadius: 9, background: "hsl(220 15% 14%)", border: "1px solid hsl(220 15% 22%)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <FileText size={17} color={PURPLE} />
                          </div>

                          {/* Info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: "hsl(220 20% 90%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>
                                {ds.original_filename}
                              </span>
                              {ds.logical_dataset_name ? (
                                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: `${schemaColor}22`, border: `1px solid ${schemaColor}44`, color: schemaColor, fontWeight: 600, flexShrink: 0 }}>
                                  {ds.logical_dataset_name}
                                </span>
                              ) : (
                                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "hsl(220 15% 14%)", border: "1px solid hsl(220 15% 22%)", color: "hsl(220 10% 45%)", flexShrink: 0 }}>
                                  Unmapped
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: 14, fontSize: 12, color: "hsl(220 10% 50%)" }}>
                              <span>{ds.row_count?.toLocaleString() ?? 0} rows</span>
                              <span>{ds.columns?.length ?? 0} cols</span>
                              {ds.created_at && <span>{formatRelativeTime(ds.created_at)}</span>}
                            </div>
                          </div>

                          {/* Actions */}
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                            <button
                              onClick={() => router.push(`/preview?datasetId=${ds.id}`)}
                              style={{
                                background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)",
                                borderRadius: 7, cursor: "pointer", color: BLUE,
                                display: "flex", alignItems: "center", gap: 5, fontSize: 12, padding: "5px 10px", fontWeight: 600,
                              }}
                            >
                              <Eye size={12} /> View
                            </button>
                            {ds.logical_dataset_name ? (
                              <button
                                onClick={() => unmapMutation.mutate(ds.id)}
                                disabled={unmapMutation.isPending}
                                title="Remove AI-assigned schema so you can assign a new one"
                                style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 7, cursor: "pointer", color: "#f87171", display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: "5px 9px", fontWeight: 600 }}
                              >
                                <Unlink size={11} /> Unmap
                              </button>
                            ) : (
                              <button
                                onClick={() => openSchemaModal(ds.id, ds.original_filename || "Dataset")}
                                style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: 7, cursor: "pointer", color: PURPLE, display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: "5px 9px", fontWeight: 600 }}
                              >
                                <Plus size={11} /> Schema
                              </button>
                            )}
                            <button
                              onClick={() => deleteMutation.mutate(ds.id)}
                              disabled={deleteMutation.isPending || bulkDeleting}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", display: "flex", alignItems: "center", padding: "5px 6px" }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "hsl(220 10% 45%)" }}>
                  <Database size={32} style={{ margin: "0 auto 10px", opacity: 0.4, display: "block" }} />
                  <p style={{ fontSize: 14 }}>No history yet. Upload a file to get started.</p>
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
                Manage schemas on the Profiles page →
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
                        style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#f87171", padding: 4, opacity: 0.45, transition: "opacity 0.15s", borderRadius: 6, display: "flex", alignItems: "center" }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.45")}
                      >
                        {deleteDynamicSchemaMutation.isPending ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
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
                  { label: "Static schemas", value: staticSchemasCount, color: BLUE },
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
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setSchemaModal(null)}
        >
          <div
            style={{ background: "hsl(220 15% 13%)", border: "1px solid hsl(220 15% 25%)", borderRadius: 14, padding: 28, width: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.6)", maxHeight: "90vh", overflowY: "auto" }}
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
              style={{ width: "100%", background: "hsl(220 15% 10%)", border: "1px solid hsl(220 15% 25%)", borderRadius: 8, padding: "9px 12px", color: "hsl(220 20% 92%)", fontSize: 13, outline: "none", marginBottom: 18, boxSizing: "border-box" }}
            />

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
                <div style={{ maxHeight: 220, overflowY: "auto", background: "hsl(220 15% 10%)", borderRadius: 8, border: "1px solid hsl(220 15% 20%)", padding: "4px 0" }}>
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
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", cursor: "pointer", background: checked ? "rgba(167,139,250,0.06)" : "transparent" }}
                      >
                        <div style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, border: `1.5px solid ${checked ? PURPLE : "hsl(220 15% 30%)"}`, background: checked ? `${PURPLE}33` : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {checked && <div style={{ width: 8, height: 8, background: PURPLE, borderRadius: 1 }} />}
                        </div>
                        <span style={{ fontSize: 12, fontFamily: "monospace", color: checked ? "hsl(220 20% 88%)" : "hsl(220 10% 55%)" }}>
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
