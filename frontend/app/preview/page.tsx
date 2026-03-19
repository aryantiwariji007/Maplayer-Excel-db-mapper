"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ingestApi, analyticsApi } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import Header from "@/components/layout/Header";
import type { PreviewData } from "@/types";
import {
  Database, Layers, Loader2, Download, Eye, EyeOff,
  ChevronRight, ChevronDown, FolderOpen, FolderClosed,
  FileSpreadsheet, File as FileIcon, Sparkles
} from "lucide-react";

/* ──────────────────── Table Component ──────────────────── */
function PreviewTable({ data, label }: { data: PreviewData | { columns: string[]; rows: Record<string, unknown>[] }; label?: string }) {
  const columns = data.columns;
  const rows = (data as any).rows ?? [];
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());

  const toggleCol = (col: string) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });

  const visibleCols = columns.filter((c) => !hiddenCols.has(c));

  const exportCsv = () => {
    const csvRows = [visibleCols.join(",")];
    rows.forEach((row: any) =>
      csvRows.push(visibleCols.map((c) => JSON.stringify(row[c] ?? "")).join(","))
    );
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${label ?? "preview"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fade-in">
      {label && (
        <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={14} color="#a78bfa" />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>{label}</span>
          <span style={{ fontSize: 11, color: "hsl(220 10% 45%)" }}>— column names remapped to schema keys</span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {columns.map((col, i) => (
            <button
              key={col || i}
              onClick={() => toggleCol(col)}
              title={hiddenCols.has(col) ? "Show column" : "Hide column"}
              style={{
                padding: "2px 8px", borderRadius: 999, fontSize: 11, cursor: "pointer",
                border: "1px solid",
                background: hiddenCols.has(col) ? "transparent" : "rgba(96,165,250,0.1)",
                borderColor: hiddenCols.has(col) ? "hsl(220 15% 22%)" : "rgba(96,165,250,0.3)",
                color: hiddenCols.has(col) ? "hsl(220 10% 40%)" : "#93c5fd",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              {hiddenCols.has(col) ? <EyeOff size={9} /> : <Eye size={9} />}
              {col}
            </button>
          ))}
        </div>
        <button
          onClick={exportCsv}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
            background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
            borderRadius: 8, cursor: "pointer", color: "#a78bfa", fontSize: 13, fontWeight: 600,
          }}
        >
          <Download size={13} /> Export CSV
        </button>
      </div>
      <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid hsl(220 15% 16%)" }}>
        <table className="data-table">
          <thead>
            <tr>
              {visibleCols.map((c, i) => <th key={c || i}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any, i: number) => (
              <tr key={i}>
                {visibleCols.map((c, j) => (
                  <td key={c || j} style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {String(row[c] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: "hsl(220 10% 45%)", marginTop: 8 }}>
        Showing {rows.length} rows · {visibleCols.length} of {columns.length} columns visible
      </p>
    </div>
  );
}

/* ──────────────────── Source Files Sub-list ──────────────────── */
type SourceFile = { dataset_id: string; file_name: string; row_count: number; column_mapping: Record<string, string>; mapped_at: string };

function SourceFilesList({
  logicalId,
  selectedFileId,
  onSelectFile,
}: {
  logicalId: string;
  selectedFileId: string | null;
  onSelectFile: (f: SourceFile) => void;
}) {
  const { data: files, isLoading } = useQuery({
    queryKey: ["source-files", logicalId],
    queryFn: () => ingestApi.listSourceFiles(logicalId),
  });

  if (isLoading) return <div style={{ padding: "6px 0 6px 28px" }}><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /></div>;
  if (!files || files.length === 0) return <p style={{ fontSize: 11, color: "hsl(220 10% 40%)", padding: "4px 0 4px 28px" }}>No files mapped yet.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 20, paddingTop: 4, paddingBottom: 4 }}>
      {files.map((f) => (
        <button
          key={f.dataset_id}
          onClick={() => onSelectFile(f)}
          style={{
            display: "flex", alignItems: "center", gap: 7, textAlign: "left",
            padding: "7px 10px", borderRadius: 8, cursor: "pointer", border: "1px solid",
            background: selectedFileId === f.dataset_id ? "rgba(96,165,250,0.12)" : "hsl(220 15% 8%)",
            borderColor: selectedFileId === f.dataset_id ? "rgba(96,165,250,0.4)" : "hsl(220 15% 16%)",
            transition: "all 0.12s",
          }}
        >
          <FileSpreadsheet size={12} color={selectedFileId === f.dataset_id ? "#60a5fa" : "hsl(220 10% 45%)"} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "hsl(220 20% 85%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 1 }}>
              {f.file_name}
            </p>
            <p style={{ fontSize: 10, color: "hsl(220 10% 46%)" }}>
              {f.row_count?.toLocaleString()} rows
            </p>
          </div>
          {selectedFileId === f.dataset_id && (
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#60a5fa", flexShrink: 0 }} />
          )}
        </button>
      ))}
    </div>
  );
}

/* ──────────────────── Main Page ──────────────────── */
type ViewMode =
  | { type: "empty" }
  | { type: "raw"; datasetId: string }
  | { type: "unified"; logicalId: string }
  | { type: "source-file"; datasetId: string; fileName: string };

export default function PreviewPage() {
  const { productId } = useAppStore();
  const [tab, setTab] = useState<"raw" | "logical">("raw");
  const [viewMode, setViewMode] = useState<ViewMode>({ type: "empty" });
  // Tracks which logical dataset folders are open
  const [expandedLogical, setExpandedLogical] = useState<Set<string>>(new Set());
  // Tracks preview mode for source-files
  const [sourceMode, setSourceMode] = useState<"full" | "mapped_only">("full");

  /* ─── Queries ─── */
  const { data: datasets, isLoading: loadingDatasets } = useQuery({
    queryKey: ["datasets", productId],
    queryFn: () => ingestApi.listDatasets(productId),
    enabled: !!productId,
  });

  const { data: logicalDatasets, isLoading: loadingLogical } = useQuery({
    queryKey: ["logical-datasets", productId],
    queryFn: () => ingestApi.listLogicalDatasets(productId),
    enabled: !!productId,
  });

  const { data: rawPreview, isLoading: loadingRawPreview } = useQuery({
    queryKey: ["preview-raw", viewMode.type === "raw" ? (viewMode as any).datasetId : null],
    queryFn: () => analyticsApi.previewDataset((viewMode as any).datasetId!),
    enabled: viewMode.type === "raw",
  });

  const { data: logicalPreview, isLoading: loadingLogicalPreview } = useQuery({
    queryKey: ["preview-logical", viewMode.type === "unified" ? (viewMode as any).logicalId : null],
    queryFn: () => analyticsApi.previewLogicalDataset((viewMode as any).logicalId!),
    enabled: viewMode.type === "unified",
  });

  const { data: remappedPreview, isLoading: loadingRemapped } = useQuery({
    queryKey: ["preview-remapped", viewMode.type === "source-file" ? (viewMode as any).datasetId : null, sourceMode],
    queryFn: () => ingestApi.previewRemapped((viewMode as any).datasetId!, sourceMode),
    enabled: viewMode.type === "source-file",
  });

  const isLoading = viewMode.type === "raw" ? loadingRawPreview
    : viewMode.type === "unified" ? loadingLogicalPreview
    : viewMode.type === "source-file" ? loadingRemapped
    : false;

  const previewData = viewMode.type === "raw" ? rawPreview
    : viewMode.type === "unified" ? logicalPreview
    : viewMode.type === "source-file" ? remappedPreview
    : null;

  const toggleExpanded = (id: string) => {
    setExpandedLogical((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const getPreviewLabel = () => {
    if (viewMode.type === "source-file") return (viewMode as any).fileName as string;
    return undefined;
  };

  return (
    <>
      <Header title="Preview" subtitle="Inspect raw and unified logical dataset rows" />
      <div className="page-body">
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, maxWidth: 1300 }}>

          {/* ── LEFT SIDEBAR ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Tab switcher */}
            <div style={{ display: "flex", background: "hsl(220 15% 10%)", borderRadius: 10, padding: 4, gap: 4 }}>
              {(["raw", "logical"] as const).map((t, i) => (
                <button
                  key={t || i}
                  onClick={() => { setTab(t); setViewMode({ type: "empty" }); }}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 7, border: "none",
                    cursor: "pointer", fontWeight: 600, fontSize: 12, textTransform: "capitalize",
                    background: tab === t ? "linear-gradient(135deg, rgba(167,139,250,0.2), rgba(96,165,250,0.15))" : "transparent",
                    color: tab === t ? "#a78bfa" : "hsl(220 10% 50%)",
                    transition: "all 0.12s",
                  }}
                >
                  {t === "raw" ? "Raw Datasets" : "Logical (Unified)"}
                </button>
              ))}
            </div>

            <div className="card-glass" style={{ padding: "14px 12px" }}>
              <h3 style={{ fontSize: 11, fontWeight: 700, color: "hsl(220 10% 50%)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 12 }}>
                {tab === "raw" ? "Physical Datasets" : "Schema Groups"}
              </h3>

              {/* ── Raw Datasets list ── */}
              {tab === "raw" && (
                loadingDatasets ? <Loader2 size={14} /> :
                  (datasets ?? []).map((ds, i) => (
                    <button
                      key={ds.id || i}
                      onClick={() => setViewMode({ type: "raw", datasetId: ds.id })}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", marginBottom: 6,
                        padding: "9px 12px", borderRadius: 9, cursor: "pointer", border: "1px solid",
                        background: viewMode.type === "raw" && (viewMode as any).datasetId === ds.id ? "rgba(167,139,250,0.1)" : "hsl(220 15% 10%)",
                        borderColor: viewMode.type === "raw" && (viewMode as any).datasetId === ds.id ? "rgba(167,139,250,0.4)" : "hsl(220 15% 18%)",
                        transition: "all 0.12s",
                      }}
                    >
                      <Database size={12} color="#60a5fa" style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(220 20% 86%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                          {ds.original_filename}
                        </span>
                        <span style={{ fontSize: 10, color: "hsl(220 10% 48%)" }}>{ds.row_count?.toLocaleString()} rows</span>
                      </div>
                    </button>
                  ))
              )}

              {/* ── Logical Datasets tree ── */}
              {tab === "logical" && (
                loadingLogical ? <Loader2 size={14} /> :
                  (logicalDatasets ?? []).map((ld, i) => {
                    const isExpanded = expandedLogical.has(ld.id);
                    const isUnifiedSelected = viewMode.type === "unified" && (viewMode as any).logicalId === ld.id;

                    return (
                      <div key={ld.id || i} style={{ marginBottom: 4 }}>
                        {/* ── Schema Group Row ── */}
                        <div style={{
                          display: "flex", alignItems: "center", borderRadius: 9, border: "1px solid",
                          background: isUnifiedSelected ? "rgba(167,139,250,0.1)" : "hsl(220 15% 10%)",
                          borderColor: isUnifiedSelected ? "rgba(167,139,250,0.4)" : "hsl(220 15% 18%)",
                          transition: "all 0.12s", overflow: "hidden",
                        }}>
                          {/* Click group name → show unified preview */}
                          <button
                            onClick={() => setViewMode({ type: "unified", logicalId: ld.id })}
                            style={{
                              flex: 1, display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                              padding: "9px 10px", background: "transparent", border: "none", cursor: "pointer",
                            }}
                          >
                            <Layers size={12} color="#a78bfa" style={{ flexShrink: 0 }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: "hsl(220 20% 88%)" }}>
                              {ld.dataset_name}
                            </span>
                          </button>

                          {/* Expand/collapse the Sources folder */}
                          <button
                            onClick={() => toggleExpanded(ld.id)}
                            title={isExpanded ? "Hide source files" : "Show source files"}
                            style={{
                              padding: "9px 10px", background: "transparent", border: "none",
                              borderLeft: "1px solid hsl(220 15% 16%)",
                              cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: "hsl(220 10% 50%)",
                              transition: "all 0.12s",
                            }}
                          >
                            {isExpanded
                              ? <><FolderOpen size={13} color="#fbbf24" /><ChevronDown size={11} /></>
                              : <><FolderClosed size={13} color="#fbbf24" /><ChevronRight size={11} /></>
                            }
                          </button>
                        </div>

                        {/* ── Source Files Sub-tree (expandable) ── */}
                        {isExpanded && (
                          <div style={{
                            marginTop: 3, marginLeft: 8,
                            borderLeft: "2px solid hsl(220 15% 20%)",
                            paddingLeft: 4,
                            animation: "slideDown 0.15s ease-out",
                          }}>
                            {/* Label */}
                            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 8px 2px" }}>
                              <FolderOpen size={10} color="#fbbf24" />
                              <span style={{ fontSize: 10, fontWeight: 700, color: "hsl(220 10% 46%)", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                                Source Files
                              </span>
                            </div>
                            <SourceFilesList
                              logicalId={ld.id}
                              selectedFileId={viewMode.type === "source-file" ? (viewMode as any).datasetId : null}
                              onSelectFile={(f) => setViewMode({ type: "source-file", datasetId: f.dataset_id, fileName: f.file_name })}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          {/* ── RIGHT PREVIEW PANEL ── */}
          <div className="card-glass">
            {/* Dynamic header */}
            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>Data Preview</h3>
                {viewMode.type === "unified" && (
                  <span style={{ fontSize: 12, padding: "2px 10px", borderRadius: 999, background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", color: "#c4b5fd" }}>
                    Unified View
                  </span>
                )}
                {viewMode.type === "source-file" && (
                  <span style={{ fontSize: 12, padding: "2px 10px", borderRadius: 999, background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.3)", color: "#93c5fd", display: "flex", alignItems: "center", gap: 5 }}>
                    <Sparkles size={10} /> Schema-Mapped · {(viewMode as any).fileName}
                  </span>
                )}
              </div>

              {viewMode.type === "source-file" && (
                <div style={{ display: "flex", background: "hsl(220 15% 10%)", borderRadius: 8, padding: 3, border: "1px solid hsl(220 15% 18%)" }}>
                  <button
                    onClick={() => setSourceMode("full")}
                    style={{
                      padding: "4px 12px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none",
                      background: sourceMode === "full" ? "rgba(96,165,250,0.15)" : "transparent",
                      color: sourceMode === "full" ? "#93c5fd" : "hsl(220 10% 50%)",
                      transition: "all 0.15s"
                    }}
                  >
                    Full Dataset
                  </button>
                  <button
                    onClick={() => setSourceMode("mapped_only")}
                    style={{
                      padding: "4px 12px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none",
                      background: sourceMode === "mapped_only" ? "rgba(167,139,250,0.15)" : "transparent",
                      color: sourceMode === "mapped_only" ? "#c4b5fd" : "hsl(220 10% 50%)",
                      transition: "all 0.15s"
                    }}
                  >
                    Mapped Columns Only
                  </button>
                </div>
              )}
            </div>

            {isLoading ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "hsl(220 10% 45%)" }}>
                <Loader2 size={24} style={{ margin: "0 auto 10px", display: "block" }} />
                Loading preview…
              </div>
            ) : previewData && previewData.columns && previewData.columns.length > 0 ? (
              <PreviewTable
                data={previewData as any}
                label={viewMode.type === "source-file" ? (viewMode as any).fileName : undefined}
              />
            ) : previewData ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "hsl(220 10% 40%)" }}>
                <FileIcon size={40} style={{ margin: "0 auto 14px", display: "block", opacity: 0.3 }} />
                <p style={{ fontSize: 14 }}>No data available yet. Map some files first.</p>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "hsl(220 10% 40%)" }}>
                <div style={{ position: "relative", width: 80, height: 80, margin: "0 auto 18px" }}>
                  <Layers size={80} style={{ opacity: 0.06, position: "absolute", top: 0, left: 0 }} />
                  <FolderOpen size={36} style={{ opacity: 0.25, position: "absolute", top: 22, left: 22 }} color="#fbbf24" />
                </div>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: "hsl(220 10% 55%)" }}>Nothing selected</p>
                <p style={{ fontSize: 12, color: "hsl(220 10% 38%)" }}>
                  {tab === "logical"
                    ? "Click a schema group to see its unified view, or expand the 📁 folder to browse individual source files."
                    : "Select a dataset from the left panel."}
                </p>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
