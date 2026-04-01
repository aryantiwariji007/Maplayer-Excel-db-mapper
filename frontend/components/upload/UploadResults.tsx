"use client";
import { useState } from "react";
import { CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Plus, Zap, Unlink } from "lucide-react";
import type { UploadResult } from "@/types";

const PURPLE = "#a78bfa";
const BLUE = "#60a5fa";
const GREEN = "#4ade80";

function SchemaBadge({ type }: { type?: string | null }) {
  if (type === "static") return (
    <span style={{ background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)", color: BLUE, fontSize: 10, padding: "2px 7px", borderRadius: 99, fontWeight: 700 }}>
      Static
    </span>
  );
  if (type === "dynamic") return (
    <span style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: GREEN, fontSize: 10, padding: "2px 7px", borderRadius: 99, fontWeight: 700 }}>
      Dynamic
    </span>
  );
  return null;
}

function ResultRow({ r, onCreateSchema, onUnmap }: { r: UploadResult; onCreateSchema?: (r: UploadResult) => void; onUnmap?: (r: UploadResult) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isSuccess = r.status === "success";
  const name = r.file_name || r.filename || "File";
  const rows = r.rows ?? r.row_count ?? 0;
  const cols = r.columns?.length ?? 0;
  const confidence = r.match_confidence ?? 0;
  const mappingEntries = Object.entries(r.column_mapping ?? {});

  return (
    <div style={{
      padding: "12px 14px",
      background: "hsl(220 15% 10%)",
      borderRadius: 10,
      border: `1px solid ${isSuccess ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.25)"}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {isSuccess
          ? <CheckCircle2 size={15} color={GREEN} style={{ flexShrink: 0, marginTop: 1 }} />
          : <AlertCircle size={15} color="#f87171" style={{ flexShrink: 0, marginTop: 1 }} />
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: "hsl(220 20% 90%)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "hsl(220 10% 50%)" }}>{rows.toLocaleString()} rows · {cols} cols</span>
            {isSuccess && r.auto_mapped && r.mapped_to && (
              <>
                <SchemaBadge type={r.schema_type} />
                <span style={{ fontSize: 11, fontWeight: 600, color: r.schema_type === "static" ? BLUE : GREEN }}>
                  {r.mapped_to}
                </span>
                <span style={{ fontSize: 11, color: "hsl(220 10% 45%)" }}>
                  {Math.round(confidence * 100)}% match
                </span>
                {r.schema_type === "dynamic" && onUnmap && (
                  <button
                    onClick={() => onUnmap(r)}
                    title="Unmap — remove this schema assignment so you can create a new one"
                    style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171", fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}
                  >
                    <Unlink size={10} /> Unmap
                  </button>
                )}
              </>
            )}
            {isSuccess && !r.auto_mapped && (
              <>
                <span style={{ fontSize: 11, color: "hsl(220 10% 45%)" }}>No schema mapped</span>
                {onCreateSchema && (
                  <button
                    onClick={() => onCreateSchema(r)}
                    style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)", color: PURPLE, fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}
                  >
                    <Plus size={10} /> Create Schema
                  </button>
                )}
              </>
            )}
            {!isSuccess && r.error && (
              <span style={{ fontSize: 11, color: "#f87171" }}>{r.error}</span>
            )}
          </div>
        </div>
        {mappingEntries.length > 0 && (
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", color: PURPLE, fontSize: 11, display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {mappingEntries.length} cols
          </button>
        )}
      </div>

      {expanded && mappingEntries.length > 0 && (
        <div style={{ marginTop: 10, paddingLeft: 25, display: "flex", flexWrap: "wrap", gap: 5 }}>
          {mappingEntries.map(([src, tgt], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: "hsl(220 15% 14%)", borderRadius: 6, padding: "3px 8px", fontSize: 11 }}>
              <code style={{ color: BLUE }}>{src}</code>
              <span style={{ color: "hsl(220 10% 40%)" }}>→</span>
              <code style={{ color: GREEN }}>{tgt}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  results: UploadResult[];
  onCreateSchema?: (r: UploadResult) => void;
  onUnmap?: (r: UploadResult) => void;
  isPending?: boolean;
}

export default function UploadResults({ results, onCreateSchema, onUnmap, isPending }: Props) {
  if (results.length === 0) return null;
  const successCount = results.filter(r => r.status === "success").length;
  const errorCount = results.filter(r => r.status === "error").length;
  const mappedCount = results.filter(r => r.auto_mapped).length;

  return (
    <div className="card-glass">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Zap size={15} color={PURPLE} />
        <h3 style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Upload Results</h3>
        <div style={{ display: "flex", gap: 6 }}>
          {successCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", color: GREEN, padding: "2px 8px", borderRadius: 99 }}>
              {successCount} ok
            </span>
          )}
          {mappedCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", color: PURPLE, padding: "2px 8px", borderRadius: 99 }}>
              {mappedCount} mapped
            </span>
          )}
          {errorCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171", padding: "2px 8px", borderRadius: 99 }}>
              {errorCount} failed
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {results.map((r, i) => (
          <ResultRow
            key={i}
            r={r}
            onCreateSchema={
              r.status === "success" && !r.auto_mapped && !isPending ? onCreateSchema : undefined
            }
            onUnmap={
              r.status === "success" && r.auto_mapped && r.schema_type === "dynamic" && !isPending ? onUnmap : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
