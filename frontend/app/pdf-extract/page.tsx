"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileText,
  Loader2,
  Eye,
  Sparkles,
  ChevronRight,
  BarChart3,
  Upload,
  BookOpen,
  Search,
  Trash2,
  Plus,
  Save,
} from "lucide-react";
import { pdfApi, schemasApi } from "@/lib/api";
import type {
  PdfExtractResponse,
  PdfPreviewResponse,
  PdfAnalyzeResponse,
  TargetSchemaResponse,
  DynamicColumnDef,
  DetectedColumn,
} from "@/types";
import { useAppStore } from "@/store/useAppStore";
import Header from "@/components/layout/Header";

const PURPLE = "#a78bfa";
const BLUE = "#60a5fa";
const GREEN = "#4ade80";
const ORANGE = "#fb923c";

type SchemaMode = "static" | "dynamic";

interface EditableColumn extends DetectedColumn {
  key: string;
  label: string;
  data_type: string;
  selected: boolean;
}

const DATA_TYPES = ["string", "integer", "float", "boolean", "timestamp"];

function toSnakeCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function PdfExtractPage() {
  const { productId } = useAppStore();

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageImageB64, setPageImageB64] = useState<string | null>(null);
  const [schemaId, setSchemaId] = useState("");
  const [hint, setHint] = useState("");
  const [extractResult, setExtractResult] = useState<PdfExtractResponse | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Schema mode
  const [schemaMode, setSchemaMode] = useState<SchemaMode>("static");
  const [analyzeResult, setAnalyzeResult] = useState<PdfAnalyzeResponse | null>(null);
  const [editableColumns, setEditableColumns] = useState<EditableColumn[]>([]);

  // Save schema after dynamic extraction
  const [wantsSaveSchema, setWantsSaveSchema] = useState(false);
  const [saveSchemaName, setSaveSchemaName] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: schemas, refetch: refetchSchemas } = useQuery<TargetSchemaResponse[]>({
    queryKey: ["schemas", productId],
    queryFn: () => schemasApi.list(productId),
  });

  const previewMutation = useMutation<PdfPreviewResponse, Error, void>({
    mutationFn: () => pdfApi.previewPage(pdfFile!, pageNum),
    onSuccess: (data) => {
      setPageImageB64(data.page_image_b64);
      setPageCount(data.page_count);
      // Reset analyze state when page changes
      setAnalyzeResult(null);
      setEditableColumns([]);
    },
    onError: (err) => toast.error(err.message || "Failed to render page"),
  });

  const analyzeMutation = useMutation<PdfAnalyzeResponse, Error, void>({
    mutationFn: () => pdfApi.analyzeTable(pdfFile!, pageNum, productId),
    onSuccess: (data) => {
      setAnalyzeResult(data);
      setEditableColumns(
        data.detected_columns.map((col) => ({
          ...col,
          key: col.suggested_key,
          label: col.detected_header,
          selected: true,
        }))
      );
      if (data.best_match) {
        setSchemaMode("static");
        setSchemaId(data.best_match.schema_id);
        toast.success(
          `Matched "${data.best_match.schema_name}" — ${Math.round(data.best_match.confidence * 100)}% confidence`
        );
      } else {
        setSchemaMode("dynamic");
        toast.info(
          data.detected_columns.length > 0
            ? `${data.detected_columns.length} columns detected — custom selection active`
            : "No table detected on this page"
        );
      }
    },
    onError: (err) => toast.error(err.message || "Table analysis failed"),
  });

  const extractMutation = useMutation<PdfExtractResponse, Error, void>({
    mutationFn: () => {
      if (schemaMode === "dynamic") {
        const selectedCols: DynamicColumnDef[] = editableColumns
          .filter((c) => c.selected)
          .map(({ key, label, data_type }) => ({ key, label, data_type }));
        return pdfApi.extractData(pdfFile!, pageNum, productId, {
          dynamicColumns: selectedCols,
          hint: hint || undefined,
        });
      }
      return pdfApi.extractData(pdfFile!, pageNum, productId, {
        schemaId,
        hint: hint || undefined,
      });
    },
    onSuccess: (data) => {
      setExtractResult(data);
      toast.success(`Extracted ${data.row_count} rows from page ${pageNum}`);
    },
    onError: (err) => toast.error(err.message || "Extraction failed"),
  });

  const saveSchemasMutation = useMutation<unknown, Error, void>({
    mutationFn: () => {
      const cols = editableColumns.filter((c) => c.selected);
      return schemasApi.create({
        product_id: productId,
        schema_name: saveSchemaName,
        columns: cols.map(({ key, label, data_type }) => ({
          key,
          label,
          data_type,
          required: false,
        })),
      });
    },
    onSuccess: () => {
      toast.success(`Schema "${saveSchemaName}" saved`);
      setSaveSchemaName("");
      setWantsSaveSchema(false);
      refetchSchemas();
    },
    onError: (err) => toast.error(err.message || "Failed to save schema"),
  });

  function handleFileSelect(file: File | null) {
    if (!file || file.type !== "application/pdf") {
      if (file) toast.error("Please select a PDF file");
      return;
    }
    setPdfFile(file);
    setPageImageB64(null);
    setPageCount(null);
    setExtractResult(null);
    setPageNum(1);
    setAnalyzeResult(null);
    setEditableColumns([]);
  }

  function getColumnLabel(key: string): string {
    if (schemaMode === "dynamic") {
      return editableColumns.find((ec) => ec.key === key)?.label || key;
    }
    const schema = schemas?.find((s) => String(s.id) === schemaId);
    return schema?.columns?.find((c) => c.key === key)?.label || key;
  }

  function updateEditableColumn(index: number, field: keyof EditableColumn, value: unknown) {
    setEditableColumns((prev) =>
      prev.map((col, i) => (i === index ? { ...col, [field]: value } : col))
    );
  }

  function removeEditableColumn(index: number) {
    setEditableColumns((prev) => prev.filter((_, i) => i !== index));
  }

  function addBlankColumn() {
    setEditableColumns((prev) => [
      ...prev,
      { detected_header: "", suggested_key: "", key: "", label: "", data_type: "string", selected: true },
    ]);
  }

  const selectedColCount = editableColumns.filter((c) => c.selected).length;
  const canExtract =
    pdfFile &&
    (schemaMode === "static" ? !!schemaId : selectedColCount > 0) &&
    !extractMutation.isPending;

  const inputStyle = {
    width: "100%",
    background: "hsl(220 15% 12%)",
    border: "1px solid hsl(220 15% 22%)",
    borderRadius: 8,
    padding: "8px 12px",
    color: "hsl(220 20% 90%)",
    fontSize: 13,
    outline: "none",
  } as const;

  const labelStyle = {
    fontSize: 11,
    fontWeight: 600,
    color: "hsl(220 10% 55%)" as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    display: "block",
    marginBottom: 6,
  };

  const stepBadge = (n: number) => (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #a78bfa 0%, #60a5fa 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 700,
        color: "white",
        flexShrink: 0,
      }}
    >
      {n}
    </div>
  );

  return (
    <>
      <Header title="PDF Extract" subtitle="Extract structured table data from any PDF page using Gemini AI" />

      <div className="page-body">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, maxWidth: 1200 }}>

          {/* ── LEFT COLUMN ──────────────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Step 1 — File Upload */}
            <div className="card-glass">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                {stepBadge(1)}
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>Select PDF</h3>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  handleFileSelect(e.dataTransfer.files[0] ?? null);
                }}
                className={isDragOver ? "dropzone active" : "dropzone"}
                style={{ padding: "36px 24px", cursor: "pointer" }}
              >
                {pdfFile ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: "rgba(167,139,250,0.12)",
                        border: "1px solid rgba(167,139,250,0.25)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <FileText size={20} color={PURPLE} />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "hsl(220 20% 92%)" }}>
                      {pdfFile.name}
                    </div>
                    <div style={{ fontSize: 12, color: "hsl(220 10% 50%)" }}>
                      {(pdfFile.size / 1024).toFixed(1)} KB &mdash; click to replace
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 14,
                        background: "hsl(220 15% 12%)",
                        border: "1px solid hsl(220 15% 20%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Upload size={20} color="hsl(220 10% 50%)" />
                    </div>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 500, color: "hsl(220 20% 80%)" }}>
                        Click or drag a PDF here
                      </p>
                      <p style={{ fontSize: 12, color: "hsl(220 10% 45%)", marginTop: 4 }}>
                        Supports any PDF — engineering drawings, spec sheets, reports
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                style={{ display: "none" }}
                onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
              />
            </div>

            {/* Step 2 — Page & Preview */}
            <div className="card-glass">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                {stepBadge(2)}
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>Select Page &amp; Preview</h3>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
                <div style={{ flex: "0 0 auto" }}>
                  <label style={labelStyle}>Page number</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      min={1}
                      max={pageCount ?? 9999}
                      value={pageNum}
                      onChange={(e) => {
                        setPageNum(Number(e.target.value));
                        setPageImageB64(null);
                        setAnalyzeResult(null);
                        setEditableColumns([]);
                      }}
                      style={{ ...inputStyle, width: 80 }}
                    />
                    {pageCount && (
                      <span style={{ fontSize: 12, color: "hsl(220 10% 45%)", whiteSpace: "nowrap" }}>
                        of {pageCount}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => previewMutation.mutate()}
                  disabled={!pdfFile || previewMutation.isPending}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: "1px solid hsl(220 15% 22%)",
                    background: "hsl(220 15% 12%)",
                    color: pdfFile ? "hsl(220 20% 90%)" : "hsl(220 10% 40%)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: !pdfFile ? "not-allowed" : "pointer",
                    opacity: !pdfFile ? 0.5 : 1,
                    transition: "all 0.15s",
                    height: 36,
                  }}
                >
                  {previewMutation.isPending ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Eye size={14} />
                  )}
                  {previewMutation.isPending ? "Rendering…" : "Preview Page"}
                </button>
              </div>

              {pageImageB64 && (
                <div
                  style={{
                    borderRadius: 12,
                    overflow: "hidden",
                    border: "1px solid hsl(220 15% 18%)",
                    animation: "fadeIn 0.3s ease",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${pageImageB64}`}
                    alt={`Page ${pageNum} preview`}
                    style={{ width: "100%", display: "block" }}
                  />
                </div>
              )}

              {!pageImageB64 && !previewMutation.isPending && (
                <div
                  style={{
                    height: 120,
                    borderRadius: 12,
                    border: "1px dashed hsl(220 15% 18%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "hsl(220 10% 35%)",
                    fontSize: 13,
                    gap: 8,
                  }}
                >
                  <Eye size={16} style={{ opacity: 0.4 }} />
                  Page preview will appear here
                </div>
              )}
            </div>

            {/* Step 3 — Configure Extraction */}
            <div className="card-glass">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                {stepBadge(3)}
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>Configure Extraction</h3>
              </div>

              {/* ── Analyze button ── */}
              <div style={{ marginBottom: 16 }}>
                <button
                  onClick={() => analyzeMutation.mutate()}
                  disabled={!pageImageB64 || analyzeMutation.isPending}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: `1px solid ${pageImageB64 ? "rgba(96,165,250,0.4)" : "hsl(220 15% 20%)"}`,
                    background: pageImageB64 ? "rgba(96,165,250,0.08)" : "hsl(220 15% 10%)",
                    color: pageImageB64 ? BLUE : "hsl(220 10% 35%)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: !pageImageB64 ? "not-allowed" : "pointer",
                    opacity: !pageImageB64 ? 0.5 : 1,
                    transition: "all 0.15s",
                  }}
                >
                  {analyzeMutation.isPending ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Search size={14} />
                  )}
                  {analyzeMutation.isPending ? "Analyzing table…" : "Analyze Table with AI"}
                </button>

                {/* Analysis result badge */}
                {analyzeResult && !analyzeMutation.isPending && (
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        borderRadius: 6,
                        background: "rgba(74,222,128,0.08)",
                        border: "1px solid rgba(74,222,128,0.2)",
                        color: GREEN,
                        fontWeight: 600,
                      }}
                    >
                      {analyzeResult.detected_columns.length} columns detected
                    </span>
                    {analyzeResult.best_match && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: "3px 8px",
                          borderRadius: 6,
                          background: "rgba(96,165,250,0.08)",
                          border: "1px solid rgba(96,165,250,0.2)",
                          color: BLUE,
                          fontWeight: 600,
                        }}
                      >
                        Matched &ldquo;{analyzeResult.best_match.schema_name}&rdquo; —{" "}
                        {Math.round(analyzeResult.best_match.confidence * 100)}%
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* ── Mode toggle ── */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Schema mode</label>
                <div
                  style={{
                    display: "inline-flex",
                    borderRadius: 8,
                    border: "1px solid hsl(220 15% 22%)",
                    overflow: "hidden",
                  }}
                >
                  {(["static", "dynamic"] as SchemaMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setSchemaMode(mode)}
                      style={{
                        padding: "7px 16px",
                        fontSize: 12,
                        fontWeight: 600,
                        border: "none",
                        cursor: "pointer",
                        transition: "all 0.15s",
                        background:
                          schemaMode === mode
                            ? mode === "static"
                              ? "rgba(96,165,250,0.15)"
                              : "rgba(167,139,250,0.15)"
                            : "hsl(220 15% 10%)",
                        color:
                          schemaMode === mode
                            ? mode === "static"
                              ? BLUE
                              : PURPLE
                            : "hsl(220 10% 45%)",
                        borderRight: mode === "static" ? "1px solid hsl(220 15% 22%)" : "none",
                      }}
                    >
                      {mode === "static" ? "Use Static Schema" : "Custom Columns"}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Static schema section ── */}
              {schemaMode === "static" && (
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Target Schema</label>
                  <select
                    value={schemaId}
                    onChange={(e) => setSchemaId(e.target.value)}
                    style={{ ...inputStyle, appearance: "auto" }}
                  >
                    <option value="">— select a schema —</option>
                    {schemas?.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.schema_name}
                        {s.columns?.length ? ` (${s.columns.length} columns)` : ""}
                      </option>
                    ))}
                  </select>
                  {analyzeResult?.best_match && String(analyzeResult.best_match.schema_id) === schemaId && (
                    <p style={{ fontSize: 11, color: GREEN, marginTop: 6, fontWeight: 600 }}>
                      Auto-matched — {Math.round(analyzeResult.best_match.confidence * 100)}% confidence
                    </p>
                  )}
                  {schemas?.length === 0 && (
                    <p style={{ fontSize: 11, color: "hsl(220 10% 45%)", marginTop: 6 }}>
                      No schemas found.{" "}
                      <Link href="/mapping" style={{ color: PURPLE }}>
                        Create one on the Mapping page.
                      </Link>
                    </p>
                  )}
                </div>
              )}

              {/* ── Dynamic column picker ── */}
              {schemaMode === "dynamic" && (
                <div style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Column Selection
                    </label>
                    {editableColumns.length > 0 && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 6,
                          background: "rgba(167,139,250,0.1)",
                          border: "1px solid rgba(167,139,250,0.25)",
                          color: PURPLE,
                          fontWeight: 600,
                        }}
                      >
                        {selectedColCount} of {editableColumns.length} selected
                      </span>
                    )}
                  </div>

                  {editableColumns.length === 0 ? (
                    <div
                      style={{
                        padding: "16px",
                        borderRadius: 8,
                        border: "1px dashed hsl(220 15% 20%)",
                        color: "hsl(220 10% 40%)",
                        fontSize: 12,
                        textAlign: "center",
                        marginBottom: 10,
                      }}
                    >
                      Click &ldquo;Analyze Table with AI&rdquo; above to detect columns automatically,
                      or add columns manually below.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        marginBottom: 10,
                        maxHeight: 320,
                        overflowY: "auto",
                      }}
                    >
                      {/* Header row */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "28px 1fr 1fr 110px 28px",
                          gap: 6,
                          padding: "0 4px 4px",
                        }}
                      >
                        {["", "Key (snake_case)", "Label", "Type", ""].map((h, i) => (
                          <span key={i} style={{ fontSize: 10, fontWeight: 600, color: "hsl(220 10% 40%)", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                            {h}
                          </span>
                        ))}
                      </div>

                      {editableColumns.map((col, i) => (
                        <div
                          key={i}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "28px 1fr 1fr 110px 28px",
                            gap: 6,
                            alignItems: "center",
                            padding: "6px 4px",
                            borderRadius: 6,
                            background: col.selected ? "hsl(220 15% 11%)" : "hsl(220 15% 9%)",
                            border: `1px solid ${col.selected ? "hsl(220 15% 20%)" : "hsl(220 15% 14%)"}`,
                            opacity: col.selected ? 1 : 0.5,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={col.selected}
                            onChange={(e) => updateEditableColumn(i, "selected", e.target.checked)}
                            style={{ cursor: "pointer", accentColor: PURPLE, width: 14, height: 14 }}
                          />
                          <input
                            value={col.key}
                            onChange={(e) => updateEditableColumn(i, "key", e.target.value)}
                            onBlur={(e) => updateEditableColumn(i, "key", toSnakeCase(e.target.value))}
                            placeholder="column_key"
                            style={{
                              background: "hsl(220 15% 8%)",
                              border: "1px solid hsl(220 15% 18%)",
                              borderRadius: 5,
                              padding: "4px 8px",
                              fontSize: 12,
                              fontFamily: "monospace",
                              color: PURPLE,
                              outline: "none",
                              width: "100%",
                            }}
                          />
                          <input
                            value={col.label}
                            onChange={(e) => updateEditableColumn(i, "label", e.target.value)}
                            placeholder="Display Label"
                            style={{
                              background: "hsl(220 15% 8%)",
                              border: "1px solid hsl(220 15% 18%)",
                              borderRadius: 5,
                              padding: "4px 8px",
                              fontSize: 12,
                              color: "hsl(220 20% 85%)",
                              outline: "none",
                              width: "100%",
                            }}
                          />
                          <select
                            value={col.data_type}
                            onChange={(e) => updateEditableColumn(i, "data_type", e.target.value)}
                            style={{
                              background: "hsl(220 15% 8%)",
                              border: "1px solid hsl(220 15% 18%)",
                              borderRadius: 5,
                              padding: "4px 6px",
                              fontSize: 11,
                              color: "hsl(220 10% 60%)",
                              outline: "none",
                              width: "100%",
                              appearance: "auto",
                            }}
                          >
                            {DATA_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => removeEditableColumn(i)}
                            title="Remove column"
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "hsl(220 10% 35%)",
                              padding: 2,
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={addBlankColumn}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 12px",
                      borderRadius: 7,
                      border: "1px dashed hsl(220 15% 22%)",
                      background: "transparent",
                      color: "hsl(220 10% 50%)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    <Plus size={13} />
                    Add Column
                  </button>
                </div>
              )}

              {/* ── Extraction hint ── */}
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>
                  Extraction hint{" "}
                  <span style={{ textTransform: "none", fontWeight: 400, opacity: 0.6 }}>
                    (optional)
                  </span>
                </label>
                <textarea
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder='e.g. "extract the numbered parts list in the top-right" or "extract the dimensions table at the bottom"'
                  rows={2}
                  style={{
                    ...inputStyle,
                    resize: "vertical",
                    fontFamily: "inherit",
                    lineHeight: 1.5,
                  }}
                />
                <p style={{ fontSize: 11, color: "hsl(220 10% 40%)", marginTop: 4 }}>
                  Helps Gemini locate the right table when multiple exist on the page.
                </p>
              </div>

              <button
                className="btn-gradient"
                onClick={() => extractMutation.mutate()}
                disabled={!canExtract}
                style={{
                  width: "100%",
                  padding: "10px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  fontSize: 14,
                }}
              >
                {extractMutation.isPending ? (
                  <>
                    <Loader2 size={15} className="spin" />
                    AI is extracting… this may take 15–30s
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    Extract Data
                  </>
                )}
              </button>
            </div>

            {/* Step 4 — Results */}
            {extractResult && (
              <div className="card-glass fade-in">
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  {stepBadge(4)}
                  <h3 style={{ fontSize: 15, fontWeight: 600 }}>Extracted Data</h3>
                </div>

                {/* Success banner */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    marginBottom: 18,
                    borderRadius: 10,
                    background: "rgba(74,222,128,0.08)",
                    border: "1px solid rgba(74,222,128,0.2)",
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "rgba(74,222,128,0.12)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Sparkles size={15} color={GREEN} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: GREEN }}>
                      {extractResult.row_count} row
                      {extractResult.row_count !== 1 ? "s" : ""} extracted
                    </div>
                    <div style={{ fontSize: 11, color: "hsl(220 10% 50%)", marginTop: 2 }}>
                      From page {pageNum} &rarr; &ldquo;{extractResult.schema_name}&rdquo; &mdash;{" "}
                      <code style={{ fontSize: 11, color: PURPLE }}>{extractResult.table_name}</code>
                    </div>
                  </div>
                </div>

                {/* Data table */}
                <div style={{ overflowX: "auto", marginBottom: 16 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        {extractResult.columns.map((col) => (
                          <th key={col.name}>
                            {getColumnLabel(col.name)}
                            <span
                              style={{
                                marginLeft: 5,
                                fontSize: 9,
                                fontWeight: 400,
                                opacity: 0.5,
                                textTransform: "none",
                                letterSpacing: 0,
                              }}
                            >
                              {col.type}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {extractResult.preview_rows.map((row, i) => (
                        <tr key={i}>
                          {extractResult.columns.map((col) => (
                            <td
                              key={col.name}
                              style={{
                                color:
                                  row[col.name] == null
                                    ? "hsl(220 10% 32%)"
                                    : undefined,
                                fontStyle: row[col.name] == null ? "italic" : undefined,
                              }}
                            >
                              {row[col.name] == null ? "—" : String(row[col.name])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {extractResult.row_count > extractResult.preview_rows.length && (
                  <p
                    style={{
                      fontSize: 11,
                      color: "hsl(220 10% 45%)",
                      marginBottom: 16,
                      paddingLeft: 2,
                    }}
                  >
                    Showing {extractResult.preview_rows.length} of {extractResult.row_count} rows.
                    Full dataset is saved and queryable in Analytics.
                  </p>
                )}

                {/* Save dynamic schema */}
                {extractResult.schema_mode === "dynamic" && (
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 8,
                      background: "hsl(220 15% 10%)",
                      border: "1px solid hsl(220 15% 18%)",
                      marginBottom: 16,
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "hsl(220 20% 80%)",
                        marginBottom: wantsSaveSchema ? 10 : 0,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={wantsSaveSchema}
                        onChange={(e) => setWantsSaveSchema(e.target.checked)}
                        style={{ accentColor: ORANGE, width: 14, height: 14 }}
                      />
                      Save these columns as a reusable schema
                    </label>

                    {wantsSaveSchema && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          value={saveSchemaName}
                          onChange={(e) => setSaveSchemaName(e.target.value)}
                          placeholder="Schema name…"
                          style={{
                            ...inputStyle,
                            flex: 1,
                            padding: "6px 10px",
                            fontSize: 12,
                          }}
                        />
                        <button
                          onClick={() => saveSchemasMutation.mutate()}
                          disabled={!saveSchemaName.trim() || saveSchemasMutation.isPending}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "6px 14px",
                            borderRadius: 7,
                            border: `1px solid ${ORANGE}44`,
                            background: `${ORANGE}14`,
                            color: ORANGE,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: !saveSchemaName.trim() ? "not-allowed" : "pointer",
                            opacity: !saveSchemaName.trim() ? 0.5 : 1,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {saveSchemasMutation.isPending ? (
                            <Loader2 size={12} className="spin" />
                          ) : (
                            <Save size={12} />
                          )}
                          Save Schema
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10 }}>
                  <Link
                    href="/preview"
                    className="btn-gradient"
                    style={{
                      flex: 1,
                      textAlign: "center",
                      padding: "9px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      fontSize: 13,
                      textDecoration: "none",
                    }}
                  >
                    <Eye size={14} />
                    Preview Dataset
                  </Link>
                  <Link
                    href="/analytics"
                    style={{
                      flex: 1,
                      textAlign: "center",
                      padding: "9px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      textDecoration: "none",
                      borderRadius: 8,
                      border: "1px solid hsl(220 15% 22%)",
                      background: "hsl(220 15% 12%)",
                      color: "hsl(220 20% 90%)",
                      transition: "all 0.15s",
                    }}
                  >
                    <BarChart3 size={14} />
                    Open Analytics
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN ─────────────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* How it works */}
            <div className="card-glass">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <BookOpen size={14} color={BLUE} />
                <h3 style={{ fontSize: 14, fontWeight: 600 }}>How it works</h3>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { icon: "📄", text: "Upload any PDF — engineering drawings, spec sheets, reports" },
                  { icon: "🔍", text: "Preview the exact page to confirm the table you want" },
                  { icon: "🤖", text: "Analyze table — AI detects columns and suggests a matching schema" },
                  { icon: "🎯", text: "Use a static schema or cherry-pick custom columns" },
                  { icon: "✨", text: "Gemini extracts all rows and maps them to your chosen keys" },
                  { icon: "💾", text: "Data is saved as a dataset — queryable in Analytics & Compose" },
                ].map(({ icon, text }, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                    <p style={{ fontSize: 12, color: "hsl(220 10% 55%)", lineHeight: 1.5 }}>{text}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Selected schema preview (static mode) */}
            {schemaMode === "static" && schemaId && schemas && (
              <div className="card-glass fade-in">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: BLUE,
                      flexShrink: 0,
                    }}
                  />
                  <h3 style={{ fontSize: 14, fontWeight: 600 }}>Schema Preview</h3>
                </div>
                {(() => {
                  const selected = schemas.find((s) => String(s.id) === schemaId);
                  if (!selected) return null;
                  return (
                    <>
                      <p style={{ fontSize: 12, color: "hsl(220 10% 50%)", marginBottom: 10 }}>
                        {selected.schema_name} &mdash; {selected.columns?.length ?? 0} columns
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {selected.columns?.map((col) => (
                          <div
                            key={col.key}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "5px 10px",
                              borderRadius: 6,
                              background: "hsl(220 15% 10%)",
                              border: "1px solid hsl(220 15% 16%)",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                fontFamily: "monospace",
                                color: PURPLE,
                                fontWeight: 600,
                              }}
                            >
                              {col.key}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                color: "hsl(220 10% 45%)",
                                background: "hsl(220 15% 14%)",
                                padding: "2px 6px",
                                borderRadius: 4,
                              }}
                            >
                              {col.data_type}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Stats */}
            <div className="stat-card">
              <p
                style={{
                  fontSize: 11,
                  color: "hsl(220 10% 50%)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: 12,
                }}
              >
                Extraction Status
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {[
                  {
                    label: "PDF loaded",
                    value: pdfFile ? pdfFile.name.slice(0, 18) + "…" : "—",
                    color: pdfFile ? GREEN : "hsl(220 10% 40%)",
                  },
                  {
                    label: "Page count",
                    value: pageCount ? String(pageCount) : "—",
                    color: pageCount ? BLUE : "hsl(220 10% 40%)",
                  },
                  {
                    label: "Target page",
                    value: pdfFile ? `p${pageNum}` : "—",
                    color: pdfFile ? PURPLE : "hsl(220 10% 40%)",
                  },
                  {
                    label: "Schema mode",
                    value: schemaMode === "dynamic"
                      ? `dynamic (${selectedColCount} cols)`
                      : "static",
                    color: schemaMode === "dynamic" ? PURPLE : BLUE,
                  },
                  {
                    label: "Schema",
                    value:
                      schemaMode === "dynamic"
                        ? selectedColCount > 0
                          ? `Custom (${selectedColCount} columns)`
                          : "—"
                        : schemas?.find((s) => String(s.id) === schemaId)?.schema_name ?? "—",
                    color: schemaId || selectedColCount > 0 ? BLUE : "hsl(220 10% 40%)",
                  },
                  {
                    label: "Rows extracted",
                    value: extractResult ? String(extractResult.row_count) : "—",
                    color: extractResult ? GREEN : "hsl(220 10% 40%)",
                  },
                ].map(({ label, value, color }) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 0",
                      borderBottom: "1px solid hsl(220 15% 16%)",
                    }}
                  >
                    <span style={{ fontSize: 12, color: "hsl(220 10% 55%)" }}>{label}</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color,
                        maxWidth: 140,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        textAlign: "right",
                      }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingTop: 8,
                  }}
                >
                  <span style={{ fontSize: 12, color: "hsl(220 10% 50%)" }}>Product</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: BLUE }}>{productId}</span>
                </div>
              </div>
            </div>

            {/* Quick nav */}
            <div className="card-glass">
              <p
                style={{
                  fontSize: 11,
                  color: "hsl(220 10% 50%)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: 10,
                }}
              >
                Quick Navigation
              </p>
              {[
                { href: "/upload", label: "File Upload", desc: "Ingest CSV & Excel", color: PURPLE },
                { href: "/mapping", label: "Schema Manager", desc: "Create & edit schemas", color: BLUE },
                { href: "/preview", label: "Data Preview", desc: "Browse all datasets", color: GREEN },
              ].map(({ href, label, desc, color }) => (
                <Link
                  key={href}
                  href={href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 12px",
                    marginBottom: 4,
                    borderRadius: 8,
                    background: "hsl(220 15% 10%)",
                    border: "1px solid hsl(220 15% 16%)",
                    textDecoration: "none",
                    transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLElement).style.borderColor = `${color}44`)
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLElement).style.borderColor = "hsl(220 15% 16%)")
                  }
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(220 20% 88%)" }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 11, color: "hsl(220 10% 45%)" }}>{desc}</div>
                  </div>
                  <ChevronRight size={14} color="hsl(220 10% 40%)" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
