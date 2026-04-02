"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { analyticsApi, ingestApi } from "@/lib/api";
import type { LogicalDataset, TargetSchemaResponse, CompareRequest, CompareResponse, CompareRow } from "@/types";
import {
  ArrowLeftRight, Play, Loader2, Download, Search,
  ChevronDown, ChevronUp, Info, Star, Trophy, Sparkles
} from "lucide-react";

const PURPLE = "#a78bfa";
const BLUE = "#60a5fa";
const GREEN = "#4ade80";
const AMBER = "#fbbf24";
const RED = "#f87171";

// ── Helpers ──────────────────────────────────────────────────────────────────

const INTERNAL_COLS = new Set(["dataset_id", "_row_id", "row_id", "__row_id"]);

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, "");
  }
  return String(v);
}

function exportCSV(
  rows: CompareRow[],
  groupBy: string[],
  pivotValues: string[],
  valueColumns: string[]
) {
  const headers: string[] = [
    ...groupBy,
    ...pivotValues.flatMap((pv) => valueColumns.map((vc) => `${pv} — ${vc}`)),
    ...valueColumns.map((vc) => `Best (${vc})`),
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => {
      const keyParts = groupBy.map((k) => `"${row.key[k] ?? ""}"`);
      const valParts = pivotValues.flatMap((pv) =>
        valueColumns.map((vc) => `"${fmtVal(row.values?.[pv]?.[vc])}"`)
      );
      const bestParts = valueColumns.map((vc) => `"${row.best?.[vc] ?? ""}"`);
      return [...keyParts, ...valParts, ...bestParts].join(",");
    }),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "comparison.csv";
  a.click();
}

// ── Multi-Select Dropdown ─────────────────────────────────────────────────────

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  exclude,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  exclude?: string[];
}) {
  const [open, setOpen] = useState(false);
  const filtered = options.filter((o) => !INTERNAL_COLS.has(o) && !(exclude ?? []).includes(o));
  const selSet = new Set(selected);

  function toggle(o: string) {
    onChange(selSet.has(o) ? selected.filter((x) => x !== o) : [...selected, o]);
  }

  return (
    <div style={{ position: "relative", minWidth: 160 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 6, padding: "7px 10px", background: "hsl(220 15% 12%)",
          border: `1px solid ${open ? "hsl(220 15% 30%)" : "hsl(220 15% 22%)"}`,
          borderRadius: 8, color: "hsl(220 20% 90%)", fontSize: 12, cursor: "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
          {selected.length === 0
            ? <span style={{ color: "hsl(220 10% 45%)" }}>{label}</span>
            : selected.join(", ")}
        </span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100,
          background: "hsl(220 15% 10%)", border: "1px solid hsl(220 15% 22%)",
          borderRadius: 8, minWidth: "100%", maxHeight: 220, overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}>
          {filtered.length === 0 && (
            <p style={{ padding: "8px 12px", fontSize: 12, color: "hsl(220 10% 45%)" }}>No options</p>
          )}
          {filtered.map((o) => (
            <label key={o} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
              cursor: "pointer", fontSize: 12, color: "hsl(220 20% 88%)",
            }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(220 15% 15%)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <input
                type="checkbox"
                checked={selSet.has(o)}
                onChange={() => toggle(o)}
                style={{ accentColor: PURPLE, width: 13, height: 13 }}
              />
              {o}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  productId: string;
  logicalDatasets: LogicalDataset[];
  schemas?: TargetSchemaResponse[];
}

// Selection value format: "logical:{id}" | "static:{id}"
function parseSelection(val: string): { type: "logical" | "static"; id: string } | null {
  if (!val) return null;
  const [type, id] = val.split(":");
  if ((type === "logical" || type === "static") && id) return { type, id };
  return null;
}

export default function QuoteComparison({ productId, logicalDatasets, schemas = [] }: Props) {
  const [selection, setSelection] = useState<string>("");
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [pivotOn, setPivotOn] = useState<string>("source_file");
  const [valueColumns, setValueColumns] = useState<string[]>([]);
  const [aggregation, setAggregation] = useState<CompareRequest["aggregation"]>("first");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Feature 2: AI Configure
  const [aiConfigLoading, setAiConfigLoading] = useState(false);
  const [aiRationale, setAiRationale] = useState<string>("");

  // Feature 3: AI Narrative
  const [narrative, setNarrative] = useState<{ headline: string; bullets: string[]; recommendation: string } | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);

  // Feature 1: Smart auto-detect — track whether user manually edited since last schema change
  const userEditedRef = useRef(false);
  const [autoDetectedCols, setAutoDetectedCols] = useState<string[]>([]);

  const parsed = parseSelection(selection);

  // For static TargetSchemas, derive columns directly from schema definition (no API call)
  const staticSchema = useMemo(() => {
    if (parsed?.type !== "static") return null;
    return schemas.find((s) => String(s.id) === parsed.id) ?? null;
  }, [parsed, schemas]);

  // Fetch columns for logical datasets only
  const { data: previewData, isLoading: loadingCols } = useQuery({
    queryKey: ["ld-preview-cols", parsed?.type === "logical" ? parsed.id : ""],
    queryFn: () => analyticsApi.previewLogicalDataset(parsed!.id),
    enabled: parsed?.type === "logical",
    staleTime: 60_000,
  });

  const allColumns = useMemo(() => {
    if (staticSchema) {
      // Use the schema's defined column keys — these are exactly what the user configured
      return staticSchema.columns.map((c) => c.key).filter((c) => !INTERNAL_COLS.has(c));
    }
    if (!previewData?.columns) return [];
    return (previewData.columns as string[]).filter(
      (c) => !INTERNAL_COLS.has(c) && !/^unnamed_\d+$/i.test(c)
    );
  }, [staticSchema, previewData]);

  // Feature 1: Smart column auto-detection when schema changes
  useEffect(() => {
    if (!selection || allColumns.length === 0) return;
    // Only apply if user hasn't manually edited since last schema change
    if (userEditedRef.current) return;

    // groupBy heuristics
    const groupByPatterns = [/^sr[_\s]?no$/i, /^ref[_\s]?no$/i, /_id$/i, /_no$/i, /^description$/i, /^name$/i, /^code$/i, /^item$/i, /^part$/i, /^type$/i, /^class$/i, /^category$/i];
    const detectedGroupBy = allColumns
      .filter((c) => groupByPatterns.some((p) => p.test(c)))
      .slice(0, 3);

    // valueColumns heuristics
    const valuePatterns = [/price/i, /cost/i, /rate/i, /amount/i, /value/i, /qty/i, /quantity/i, /total/i];
    const detectedValueCols = allColumns
      .filter((c) => valuePatterns.some((p) => p.test(c)))
      .slice(0, 2);

    // aggregation heuristic
    const numericPricePattern = /price|cost|rate|amount/i;
    const detectedAggregation: CompareRequest["aggregation"] = detectedValueCols.some((c) => numericPricePattern.test(c))
      ? "min"
      : "first";

    if (detectedGroupBy.length > 0) setGroupBy(detectedGroupBy);
    if (detectedValueCols.length > 0) setValueColumns(detectedValueCols);
    setAggregation(detectedAggregation);
    setAutoDetectedCols(detectedGroupBy);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allColumns, selection]);

  // selectedLdId kept for comparison API calls
  const selectedLdId = parsed?.type === "logical" ? parsed.id : "";

  const comparePayload: CompareRequest = {
    group_by: groupBy,
    pivot_on: pivotOn,
    value_columns: valueColumns,
    aggregation,
    search: search || undefined,
    limit: 5000,
  };

  const compareMutation = useMutation({
    mutationFn: () => {
      setNarrative(null);
      if (parsed?.type === "static") {
        return analyticsApi.compareTargetSchema(parsed.id, comparePayload);
      }
      return analyticsApi.compareLogicalDataset(selectedLdId, comparePayload);
    },
    onSuccess: (data) => {
      setResult(data);
      // Feature 3: Kick off AI narrative asynchronously
      if (data.rows.length > 0 && data.value_columns.length > 0) {
        // Compute vendor_stats: {vendor: {col: {min, max, avg, count}}}
        const vendorStats: Record<string, Record<string, { min: number | null; max: number | null; avg: number | null; count: number }>> = {};
        for (const pv of data.pivot_values) {
          vendorStats[pv] = {};
          for (const vc of data.value_columns) {
            const nums = data.rows
              .map((r: CompareRow) => Number(r.values?.[pv]?.[vc]))
              .filter((n: number) => !isNaN(n) && isFinite(n));
            vendorStats[pv][vc] = {
              min: nums.length > 0 ? Math.min(...nums) : null,
              max: nums.length > 0 ? Math.max(...nums) : null,
              avg: nums.length > 0 ? nums.reduce((a: number, b: number) => a + b, 0) / nums.length : null,
              count: nums.length,
            };
          }
        }
        // best_vendor: {col: vendor_name}
        const bestVendor: Record<string, string> = {};
        for (const vc of data.value_columns) {
          const b = data.rows[0]?.best?.[vc];
          if (b) bestVendor[vc] = b;
        }
        // Use the first row's best as a proxy; aggregate for real best
        for (const vc of data.value_columns) {
          const wins: Record<string, number> = {};
          data.rows.forEach((r: CompareRow) => { const b = r.best?.[vc]; if (b) wins[b] = (wins[b] || 0) + 1; });
          const top = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
          if (top) bestVendor[vc] = top[0];
        }

        const schemaName = parsed?.type === "static"
          ? (schemas.find((s) => String(s.id) === parsed?.id)?.schema_name ?? "")
          : (logicalDatasets.find((ld) => ld.id === parsed?.id)?.dataset_name ?? "");

        setNarrativeLoading(true);
        analyticsApi.compareNarrative({
          schema_name: schemaName,
          pivot_values: data.pivot_values,
          value_columns: data.value_columns,
          aggregation: data.aggregation,
          vendor_stats: vendorStats,
          best_vendor: bestVendor,
          row_count: data.row_count,
          coverage_stats: data.missing_coverage as Record<string, number>,
        }).then((n) => {
          setNarrative(n);
        }).catch(() => {
          // silently fail — narrative is non-critical
        }).finally(() => {
          setNarrativeLoading(false);
        });
      }
    },
  });

  // Sort rows
  const sortedRows = useMemo(() => {
    if (!result) return [];
    const rows = [...result.rows];
    if (!sortCol) return rows;
    rows.sort((a, b) => {
      const aVal = a.key[sortCol] ?? "";
      const bVal = b.key[sortCol] ?? "";
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [result, sortCol, sortDir]);

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const canRun = !!parsed && groupBy.length > 0 && !!pivotOn && valueColumns.length > 0;

  // Summary stats
  const summary = useMemo(() => {
    if (!result) return null;
    const totalKeys = result.row_count;
    const vendors = result.pivot_values.length;
    const complete = result.rows.filter((r) =>
      result.pivot_values.every((pv) =>
        result.value_columns.some((vc) => r.values?.[pv]?.[vc] != null)
      )
    ).length;
    // cheapest vendor (most "best" wins for first value col)
    const vc0 = result.value_columns[0];
    const wins: Record<string, number> = {};
    result.rows.forEach((r) => {
      const b = r.best?.[vc0];
      if (b) wins[b] = (wins[b] || 0) + 1;
    });
    const cheapest = Object.entries(wins).sort((a, b) => b[1] - a[1])[0]?.[0];
    return { totalKeys, vendors, complete, cheapest };
  }, [result]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1200 }}>
      {/* Config Panel */}
      <div className="card-glass" style={{ position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <ArrowLeftRight size={16} color={PURPLE} />
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>Comparison Configuration</h3>
          <span style={{
            fontSize: 10, padding: "2px 7px", background: "rgba(167,139,250,0.15)",
            border: "1px solid rgba(167,139,250,0.3)", borderRadius: 12, color: PURPLE, fontWeight: 600,
          }}>
            BETA
          </span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          {/* Dataset selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 200 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.4px" }}>
              Schema Group
            </label>
            <select
              value={selection}
              onChange={(e) => {
                setSelection(e.target.value);
                setGroupBy([]);
                setValueColumns([]);
                setPivotOn("source_file");
                setResult(null);
                setNarrative(null);
                setAiRationale("");
                setAutoDetectedCols([]);
                userEditedRef.current = false;
              }}
              style={{
                background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                borderRadius: 8, padding: "7px 10px", color: "hsl(220 20% 90%)", fontSize: 12, outline: "none",
              }}
            >
              <option value="">— Select dataset —</option>
              {schemas.length > 0 && (
                <optgroup label="Target Schemas">
                  {schemas.map((s) => (
                    <option key={`static:${s.id}`} value={`static:${s.id}`}>{s.schema_name}</option>
                  ))}
                </optgroup>
              )}
              {logicalDatasets.length > 0 && (
                <optgroup label="Schema Groups">
                  {logicalDatasets.map((ld) => (
                    <option key={`logical:${ld.id}`} value={`logical:${ld.id}`}>{ld.dataset_name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Group By */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.4px" }}>
              Group By (Key)
            </label>
            {loadingCols ? (
              <div style={{ padding: "7px 10px", fontSize: 12, color: "hsl(220 10% 45%)" }}>
                <Loader2 size={12} style={{ display: "inline", marginRight: 4 }} />Loading…
              </div>
            ) : (
              <MultiSelect
                label="Select key columns"
                options={allColumns.filter((c) => c !== pivotOn && !valueColumns.includes(c))}
                selected={groupBy}
                onChange={(v) => { userEditedRef.current = true; setGroupBy(v); }}
              />
            )}
            {autoDetectedCols.length > 0 && !userEditedRef.current && (
              <p style={{ fontSize: 11, color: "hsl(220 10% 45%)", fontStyle: "italic", marginTop: 3 }}>
                Auto-detected: {autoDetectedCols.join(", ")}
              </p>
            )}
          </div>

          {/* Compare By (Pivot) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.4px" }}>
              Compare By
            </label>
            <select
              value={pivotOn}
              onChange={(e) => {
                setPivotOn(e.target.value);
                setGroupBy(groupBy.filter((c) => c !== e.target.value));
                setValueColumns(valueColumns.filter((c) => c !== e.target.value));
              }}
              disabled={!parsed}
              style={{
                background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                borderRadius: 8, padding: "7px 10px", color: "hsl(220 20% 90%)", fontSize: 12, outline: "none",
                minWidth: 160,
              }}
            >
              <option value="source_file">Source File (Vendor)</option>
              <option value="__columns__">Columns (Side-by-side)</option>
              {allColumns
                .filter((c) => !groupBy.includes(c) && !valueColumns.includes(c))
                .map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
            </select>
          </div>

          {/* Value Columns */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.4px" }}>
              {pivotOn === "__columns__" ? "Vendor Columns" : "Values to Compare"}
            </label>
            <MultiSelect
              label={pivotOn === "__columns__" ? "Select vendor columns" : "Select value columns"}
              options={allColumns}
              selected={valueColumns}
              onChange={(v) => { userEditedRef.current = true; setValueColumns(v); }}
              exclude={pivotOn === "__columns__" ? groupBy : [...groupBy, pivotOn]}
            />
          </div>

          {/* Aggregation */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.4px" }}>
              Aggregation
            </label>
            <select
              value={aggregation}
              onChange={(e) => setAggregation(e.target.value as CompareRequest["aggregation"])}
              style={{
                background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                borderRadius: 8, padding: "7px 10px", color: "hsl(220 20% 90%)", fontSize: 12, outline: "none",
              }}
            >
              <option value="first">First value</option>
              <option value="min">Minimum</option>
              <option value="max">Maximum</option>
              <option value="avg">Average</option>
            </select>
          </div>

          {/* AI Configure Button */}
          <button
            onClick={async () => {
              if (!parsed || allColumns.length === 0) return;
              const schemaName = parsed.type === "static"
                ? (schemas.find((s) => String(s.id) === parsed.id)?.schema_name ?? "")
                : (logicalDatasets.find((ld) => ld.id === parsed.id)?.dataset_name ?? "");
              setAiConfigLoading(true);
              setAiRationale("");
              try {
                const suggestion = await analyticsApi.suggestComparison(
                  schemaName,
                  allColumns.map((k) => ({ key: k }))
                );
                if (suggestion.group_by?.length) setGroupBy(suggestion.group_by);
                if (suggestion.value_columns?.length) setValueColumns(suggestion.value_columns);
                if (suggestion.aggregation) setAggregation(suggestion.aggregation as CompareRequest["aggregation"]);
                if (suggestion.rationale) setAiRationale(suggestion.rationale);
                userEditedRef.current = false;
              } catch {
                // silently ignore — AI is best-effort
              } finally {
                setAiConfigLoading(false);
              }
            }}
            disabled={!parsed || allColumns.length === 0 || aiConfigLoading}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", alignSelf: "flex-end",
              background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.35)",
              borderRadius: 8, color: PURPLE, fontSize: 12, cursor: "pointer",
              opacity: (!parsed || allColumns.length === 0) ? 0.5 : 1,
            }}
          >
            {aiConfigLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            AI Configure
          </button>

          {/* Run Button */}
          <button
            className="btn-gradient"
            onClick={() => compareMutation.mutate()}
            disabled={!canRun || compareMutation.isPending}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 20px", alignSelf: "flex-end" }}
          >
            {compareMutation.isPending ? <Loader2 size={13} /> : <Play size={13} />}
            Run Comparison
          </button>
        </div>

        {/* AI Rationale hint */}
        {aiRationale && (
          <p style={{ fontSize: 11, color: PURPLE, fontStyle: "italic", marginTop: 10, display: "flex", alignItems: "flex-start", gap: 5 }}>
            <Sparkles size={11} style={{ marginTop: 1, flexShrink: 0 }} />
            {aiRationale}
          </p>
        )}

        {!parsed && (
          <p style={{ fontSize: 12, color: "hsl(220 10% 45%)", marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <Info size={12} />
            Select a schema group that has files from multiple vendors / sources mapped to it.
          </p>
        )}
      </div>

      {compareMutation.isError && (
        <div style={{ padding: "12px 16px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, fontSize: 13, color: "#f87171" }}>
          Comparison failed — check that your columns exist in the selected dataset and try again.
        </div>
      )}

      {result && (
        <>
          {/* Summary Cards */}
          {summary && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[
                { label: "Unique Items", value: summary.totalKeys, color: BLUE },
                { label: `${result.pivot_on === "source_file" ? "Vendors" : "Values"} Compared`, value: summary.vendors, color: PURPLE },
                { label: "Full Coverage", value: summary.complete, sub: `/ ${summary.totalKeys}`, color: GREEN },
                summary.cheapest
                  ? { label: aggregation === "max" ? "Top Performer" : "Best Value", value: summary.cheapest, color: AMBER, icon: <Trophy size={12} /> }
                  : null,
              ].filter(Boolean).map((card: any, i) => (
                <div key={i} style={{
                  flex: "1 1 140px", padding: "12px 16px",
                  background: "hsl(220 15% 10%)", border: `1px solid hsl(220 15% 18%)`,
                  borderRadius: 12,
                }}>
                  <p style={{ fontSize: 11, color: "hsl(220 10% 50%)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                    {card.icon}{card.label}
                  </p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: card.color }}>
                    {card.value}
                    {card.sub && <span style={{ fontSize: 12, color: "hsl(220 10% 50%)", marginLeft: 4 }}>{card.sub}</span>}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Feature 3: AI Narrative Card */}
          {(narrativeLoading || narrative) && (
            <div style={{
              background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.25)",
              borderRadius: 12, padding: "16px 20px",
            }}>
              {narrativeLoading && !narrative ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: PURPLE, fontSize: 13 }}>
                  <Loader2 size={14} className="animate-spin" />
                  Generating AI analysis…
                </div>
              ) : narrative && (
                <>
                  <p style={{ fontWeight: 700, color: PURPLE, fontSize: 14, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <Sparkles size={14} />
                    {narrative.headline}
                  </p>
                  <ul style={{ listStyle: "disc", paddingLeft: 20, marginBottom: 12 }}>
                    {narrative.bullets.map((b, i) => (
                      <li key={i} style={{ fontSize: 12, color: "hsl(220 20% 80%)", marginBottom: 4 }}>{b}</li>
                    ))}
                  </ul>
                  <div style={{
                    background: "rgba(96,165,250,0.1)", borderLeft: "3px solid #60a5fa",
                    borderRadius: 4, padding: "10px 14px", fontSize: 12, color: "hsl(220 20% 85%)",
                  }}>
                    <span style={{ fontWeight: 600, color: BLUE }}>Recommendation: </span>
                    {narrative.recommendation}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Search + Export Bar */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "hsl(220 10% 45%)", pointerEvents: "none" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search by ${result.group_by.join(", ")}…`}
                style={{
                  width: "100%", paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7,
                  background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                  borderRadius: 8, color: "hsl(220 20% 90%)", fontSize: 12, outline: "none",
                }}
              />
            </div>
            {search && (
              <button
                onClick={() => compareMutation.mutate()}
                style={{ padding: "7px 14px", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 8, color: PURPLE, fontSize: 12, cursor: "pointer" }}
              >
                Apply Filter
              </button>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {Object.entries(result.missing_coverage).length > 0 && (
                <div style={{ fontSize: 11, color: AMBER, display: "flex", alignItems: "center", gap: 4 }}>
                  <Info size={11} />
                  Coverage gaps: {Object.entries(result.missing_coverage).map(([pv, n]) => `${pv}: missing ${n}`).join(" · ")}
                </div>
              )}
              <button
                onClick={() => exportCSV(result.rows, result.group_by, result.pivot_values, result.value_columns)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
                  background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                  borderRadius: 8, color: "hsl(220 20% 88%)", fontSize: 12, cursor: "pointer",
                }}
              >
                <Download size={12} />Export CSV
              </button>
            </div>
          </div>

          {/* Comparison Table */}
          {result.row_count === 0 ? (
            <div className="card-glass" style={{ textAlign: "center", padding: "40px 20px", color: "hsl(220 10% 45%)" }}>
              No data found. Try adjusting your configuration or removing the search filter.
            </div>
          ) : (
            <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid hsl(220 15% 16%)" }}>
              <table className="data-table" style={{ minWidth: "100%" }}>
                <thead>
                  {/* Row 1: Key columns + vendor group headers */}
                  <tr>
                    {result.group_by.map((col) => (
                      <th
                        key={col}
                        rowSpan={result.value_columns.length > 1 ? 2 : 1}
                        onClick={() => toggleSort(col)}
                        style={{ cursor: "pointer", background: "hsl(220 15% 10%)", whiteSpace: "nowrap", userSelect: "none" }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {col}
                          {sortCol === col
                            ? sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                            : <ChevronDown size={11} style={{ opacity: 0.3 }} />
                          }
                        </span>
                      </th>
                    ))}
                    {result.pivot_values.map((pv) => (
                      <th
                        key={pv}
                        colSpan={result.value_columns.length}
                        style={{
                          textAlign: "center", background: "hsl(220 15% 10%)",
                          borderLeft: "1px solid hsl(220 15% 20%)", whiteSpace: "nowrap",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          {result.missing_coverage[pv] != null && (
                            <span title={`Missing ${result.missing_coverage[pv]} items`} style={{ color: AMBER, fontSize: 10 }}>⚠</span>
                          )}
                          {pv}
                        </span>
                      </th>
                    ))}
                    {result.value_columns.length > 0 && (
                      <th
                        colSpan={result.value_columns.length}
                        style={{ textAlign: "center", background: "hsl(220 15% 10%)", borderLeft: "1px solid hsl(220 15% 20%)", color: AMBER, whiteSpace: "nowrap" }}
                      >
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          <Star size={11} color={AMBER} />Best
                        </span>
                      </th>
                    )}
                  </tr>
                  {/* Row 2: sub-headers for value cols (only if multiple value cols) */}
                  {result.value_columns.length > 1 && (
                    <tr>
                      {result.pivot_values.flatMap((pv) =>
                        result.value_columns.map((vc) => (
                          <th
                            key={`${pv}-${vc}`}
                            style={{ background: "hsl(220 15% 9%)", fontSize: 10, fontWeight: 500, color: "hsl(220 10% 50%)", borderLeft: result.value_columns.indexOf(vc) === 0 ? "1px solid hsl(220 15% 20%)" : undefined }}
                          >
                            {vc}
                          </th>
                        ))
                      )}
                      {result.value_columns.map((vc, i) => (
                        <th
                          key={`best-${vc}`}
                          style={{ background: "hsl(220 15% 9%)", fontSize: 10, fontWeight: 500, color: AMBER, borderLeft: i === 0 ? "1px solid hsl(220 15% 20%)" : undefined }}
                        >
                          {vc}
                        </th>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {sortedRows.map((row, ri) => {
                    // Compute worst (highest numeric value) per value column across all pivot values
                    const worstPv: Record<string, string | null> = {};
                    for (const vc of result.value_columns) {
                      let maxVal = -Infinity;
                      let maxPv: string | null = null;
                      for (const pv of result.pivot_values) {
                        const v = Number(row.values?.[pv]?.[vc]);
                        if (!isNaN(v) && v > maxVal) { maxVal = v; maxPv = pv; }
                      }
                      // Only mark as worst if there are at least 2 non-null values
                      const nonNullCount = result.pivot_values.filter(
                        (pv) => row.values?.[pv]?.[vc] != null
                      ).length;
                      worstPv[vc] = nonNullCount >= 2 ? maxPv : null;
                    }

                    // Feature 4: Compute per-row mean per value col for anomaly detection
                    const rowMean: Record<string, number | null> = {};
                    for (const vc of result.value_columns) {
                      const nums = result.pivot_values
                        .map((pv) => Number(row.values?.[pv]?.[vc]))
                        .filter((n) => !isNaN(n) && isFinite(n));
                      rowMean[vc] = nums.length >= 2 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
                    }

                    return (
                    <tr key={ri}>
                      {/* Key columns */}
                      {result.group_by.map((col) => (
                        <td key={col} style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                          {row.key[col] ?? "—"}
                        </td>
                      ))}
                      {/* Value cells per vendor */}
                      {result.pivot_values.flatMap((pv) =>
                        result.value_columns.map((vc, vci) => {
                          const val = row.values?.[pv]?.[vc];
                          const isBest = row.best?.[vc] === pv;
                          const isWorst = !isBest && worstPv[vc] === pv;
                          // Feature 4: anomaly detection
                          const mean = rowMean[vc];
                          const numVal = Number(val);
                          const isAnomaly = !isBest && !isWorst && mean !== null && val != null
                            && !isNaN(numVal) && isFinite(numVal)
                            && Math.abs(numVal - mean) / mean > 0.20;
                          return (
                            <td
                              key={`${pv}-${vc}`}
                              style={{
                                textAlign: "right",
                                borderLeft: vci === 0 ? "1px solid hsl(220 15% 16%)" : undefined,
                                color: val == null ? "hsl(220 10% 35%)" : isBest ? GREEN : isWorst ? RED : isAnomaly ? AMBER : "hsl(220 20% 88%)",
                                background: isBest ? "rgba(74,222,128,0.06)" : isWorst ? "rgba(248,113,113,0.06)" : isAnomaly ? "rgba(251,191,36,0.08)" : undefined,
                                fontWeight: isBest || isWorst ? 700 : undefined,
                              }}
                            >
                              {val == null ? "—" : (
                                <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                                  {isBest && <Star size={10} color={GREEN} />}
                                  {isAnomaly && <span title="Value deviates >20% from row mean">⚠</span>}
                                  {fmtVal(val)}
                                </span>
                              )}
                            </td>
                          );
                        })
                      )}
                      {/* Best column */}
                      {result.value_columns.map((vc, i) => (
                        <td
                          key={`best-${vc}`}
                          style={{
                            fontWeight: 700, color: AMBER, textAlign: "center", whiteSpace: "nowrap",
                            borderLeft: i === 0 ? "1px solid hsl(220 15% 16%)" : undefined,
                            background: "rgba(251,191,36,0.04)",
                          }}
                        >
                          {row.best?.[vc]
                            ? <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                                <Trophy size={10} color={AMBER} />{row.best[vc]}
                              </span>
                            : <span style={{ color: "hsl(220 10% 35%)" }}>—</span>
                          }
                        </td>
                      ))}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ fontSize: 11, color: "hsl(220 10% 45%)", padding: "8px 14px" }}>
                {result.row_count} item{result.row_count !== 1 ? "s" : ""}
                {search ? ` matching "${search}"` : ""}
                {" "}· {result.pivot_values.length} {result.pivot_on === "source_file" ? "vendor(s)" : result.pivot_on === "__columns__" ? "column(s)" : `${result.pivot_on} value(s)`}
                {" "}· aggregation: {result.aggregation}
                {" "}·{" "}
                <span style={{ color: GREEN }}>★ best</span>
                {" "}·{" "}
                <span style={{ color: RED }}>✗ worst</span>
                {" "}·{" "}
                <span style={{ color: AMBER }}>⚠ &gt;20% deviation</span>
              </p>
            </div>
          )}
        </>
      )}

      {!result && !compareMutation.isPending && (
        <div className="card-glass" style={{ textAlign: "center", padding: "48px 24px" }}>
          <ArrowLeftRight size={32} color="hsl(220 10% 30%)" style={{ margin: "0 auto 12px" }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: "hsl(220 10% 55%)", marginBottom: 6 }}>
            Quote & Value Comparison
          </p>
          <p style={{ fontSize: 12, color: "hsl(220 10% 40%)", maxWidth: 420, margin: "0 auto" }}>
            Upload vendor price lists or multi-source data files mapped to the same schema group,
            then configure the comparison above to see a side-by-side pivot table.
          </p>
        </div>
      )}
    </div>
  );
}
