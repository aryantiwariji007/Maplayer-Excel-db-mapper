"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ingestApi, analyticsApi } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import Header from "@/components/layout/Header";
import type { PreviewData } from "@/types";
import { Database, Layers, Loader2, Download, Eye, EyeOff } from "lucide-react";

function PreviewTable({ data }: { data: PreviewData }) {
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());

  const toggleCol = (col: string) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });

  const visibleCols = data.columns.filter((c) => !hiddenCols.has(c));

  const exportCsv = () => {
    const rows = [visibleCols.join(",")];
    data.rows.forEach((row) =>
      rows.push(visibleCols.map((c) => JSON.stringify(row[c] ?? "")).join(","))
    );
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "preview_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fade-in">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {data.columns.map((col, i) => (
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
            {data.rows.map((row, i) => (
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
        Showing {data.rows.length} rows · {visibleCols.length} of {data.columns.length} columns visible
      </p>
    </div>
  );
}

export default function PreviewPage() {
  const { productId } = useAppStore();
  const [tab, setTab] = useState<"raw" | "logical">("raw");
  const [selectedRawId, setSelectedRawId] = useState<string | null>(null);
  const [selectedLogicalId, setSelectedLogicalId] = useState<string | null>(null);

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
    queryKey: ["preview-raw", selectedRawId],
    queryFn: () => analyticsApi.previewDataset(selectedRawId!),
    enabled: !!selectedRawId && tab === "raw",
  });

  const { data: logicalPreview, isLoading: loadingLogicalPreview } = useQuery({
    queryKey: ["preview-logical", selectedLogicalId],
    queryFn: () => analyticsApi.previewLogicalDataset(selectedLogicalId!),
    enabled: !!selectedLogicalId && tab === "logical",
  });

  const isLoading = tab === "raw" ? loadingRawPreview : loadingLogicalPreview;
  const previewData = tab === "raw" ? rawPreview : logicalPreview;

  return (
    <>
      <Header title="Preview" subtitle="Inspect raw and unified logical dataset rows" />
      <div className="page-body">
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20, maxWidth: 1300 }}>
          {/* LEFT — Selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Tabs */}
            <div style={{ display: "flex", background: "hsl(220 15% 10%)", borderRadius: 10, padding: 4, gap: 4 }}>
              {(["raw", "logical"] as const).map((t, i) => (
                <button
                  key={t || i}
                  onClick={() => { setTab(t); }}
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

            <div className="card-glass">
              <h3 style={{ fontSize: 12, fontWeight: 700, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
                {tab === "raw" ? "Physical Datasets" : "Logical Datasets"}
              </h3>
              {tab === "raw" ? (
                loadingDatasets ? <Loader2 size={14} /> :
                  (datasets ?? []).map((ds, i) => (
                    <button
                      key={ds.id || i}
                      onClick={() => setSelectedRawId(ds.id)}
                      style={{
                        display: "block", width: "100%", textAlign: "left", marginBottom: 6,
                        padding: "9px 12px", borderRadius: 9, cursor: "pointer", border: "1px solid",
                        background: selectedRawId === ds.id ? "rgba(167,139,250,0.1)" : "hsl(220 15% 10%)",
                        borderColor: selectedRawId === ds.id ? "rgba(167,139,250,0.4)" : "hsl(220 15% 18%)",
                        transition: "all 0.12s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <Database size={12} color="#60a5fa" />
                        <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(220 20% 86%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {ds.original_filename}
                        </span>
                      </div>
                      <p style={{ fontSize: 10, color: "hsl(220 10% 48%)", marginTop: 2, paddingLeft: 19 }}>
                        {ds.row_count?.toLocaleString()} rows
                      </p>
                    </button>
                  ))
              ) : (
                loadingLogical ? <Loader2 size={14} /> :
                  (logicalDatasets ?? []).map((ld, i) => (
                    <button
                      key={ld.id || i}
                      onClick={() => setSelectedLogicalId(ld.id)}
                      style={{
                        display: "block", width: "100%", textAlign: "left", marginBottom: 6,
                        padding: "9px 12px", borderRadius: 9, cursor: "pointer", border: "1px solid",
                        background: selectedLogicalId === ld.id ? "rgba(167,139,250,0.1)" : "hsl(220 15% 10%)",
                        borderColor: selectedLogicalId === ld.id ? "rgba(167,139,250,0.4)" : "hsl(220 15% 18%)",
                        transition: "all 0.12s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <Layers size={12} color="#a78bfa" />
                        <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(220 20% 86%)" }}>
                          {ld.dataset_name}
                        </span>
                      </div>
                    </button>
                  ))
              )}
            </div>
          </div>

          {/* RIGHT — Preview table */}
          <div className="card-glass">
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Data Preview</h3>
            {isLoading ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "hsl(220 10% 45%)" }}>
                <Loader2 size={24} style={{ margin: "0 auto 10px", display: "block" }} />
                Loading preview…
              </div>
            ) : previewData ? (
              <PreviewTable data={previewData} />
            ) : (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "hsl(220 10% 40%)" }}>
                <Eye size={40} style={{ margin: "0 auto 14px", display: "block", opacity: 0.3 }} />
                <p style={{ fontSize: 14 }}>Select a dataset from the left to preview its data</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
