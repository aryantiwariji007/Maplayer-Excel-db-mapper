"use client";
import type { UploadResult } from "@/types";
import { CheckCircle, XCircle, FileText, Database } from "lucide-react";

interface Props {
  results: UploadResult[];
}

export default function UploadResults({ results }: Props) {
  if (results.length === 0) return null;

  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return (
    <div className="card-glass fade-in" style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Upload Results</h3>
        <div style={{ display: "flex", gap: 8 }}>
          {successCount > 0 && <span className="badge-success">{successCount} succeeded</span>}
          {errorCount > 0 && <span className="badge-error">{errorCount} failed</span>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {results.map((r, i) => (
          <div
            key={i}
            style={{
              background: r.status === "success" ? "rgba(34,197,94,0.05)" : "rgba(239,68,68,0.05)",
              border: `1px solid ${r.status === "success" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
              borderRadius: 12, padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: r.status === "success" ? 10 : 0 }}>
              {r.status === "success"
                ? <CheckCircle size={16} color="#4ade80" />
                : <XCircle size={16} color="#f87171" />
              }
              <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{r.filename}</span>
              <span className={r.status === "success" ? "badge-success" : "badge-error"}>
                {r.status}
              </span>
            </div>
            {r.status === "success" && (
              <div style={{ display: "flex", gap: 16, paddingLeft: 26 }}>
                {r.dataset_id && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "hsl(220 10% 60%)" }}>
                    <Database size={12} />
                    <span>ID: <code style={{ color: "#a78bfa" }}>{r.dataset_id}</code></span>
                  </div>
                )}
                {r.row_count !== undefined && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "hsl(220 10% 60%)" }}>
                    <FileText size={12} />
                    <span>{r.row_count.toLocaleString()} rows</span>
                  </div>
                )}
                {r.columns && (
                  <div style={{ fontSize: 12, color: "hsl(220 10% 60%)" }}>
                    {r.columns.length} columns
                  </div>
                )}
                {r.auto_mapped && r.mapped_to && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <span style={{ color: "hsl(220 10% 60%)" }}>Auto-mapped to:</span>
                    <span className="badge-success" style={{ background: "rgba(167,139,250,0.15)", color: "#c4b5fd", borderColor: "rgba(167,139,250,0.3)" }}>
                      {r.mapped_to}
                    </span>
                  </div>
                )}
              </div>
            )}
            {r.status === "error" && r.error && (
              <p style={{ paddingLeft: 26, fontSize: 12, color: "#f87171", marginTop: 4 }}>{r.error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
