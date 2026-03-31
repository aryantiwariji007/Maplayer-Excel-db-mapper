"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { analyticsApi, ingestApi } from "@/lib/api";
import type { LogicalDataset, CompareRequest, CompareResponse, CompareRow } from "@/types";
import {
  ArrowLeftRight, Play, Loader2, Download, Search,
  ChevronDown, ChevronUp, Info, Star, Trophy
} from "lucide-react";

const PURPLE = "#a78bfa";
const BLUE = "#60a5fa";
const GREEN = "#4ade80";
const AMBER = "#fbbf24";

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
}

export default function QuoteComparison({ productId, logicalDatasets }: Props) {
  const [selectedLdId, setSelectedLdId] = useState<string>("");
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [pivotOn, setPivotOn] = useState<string>("source_file");
  const [valueColumns, setValueColumns] = useState<string[]>([]);
  const [aggregation, setAggregation] = useState<CompareRequest["aggregation"]>("first");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Fetch columns for selected logical dataset
  const { data: previewData, isLoading: loadingCols } = useQuery({
    queryKey: ["ld-preview-cols", selectedLdId],
    queryFn: () => analyticsApi.previewLogicalDataset(selectedLdId),
    enabled: !!selectedLdId,
    staleTime: 60_000,
  });

  const allColumns = useMemo(() => {
    if (!previewData?.columns) return [];
    return (previewData.columns as string[]).filter((c) => !INTERNAL_COLS.has(c));
  }, [previewData]);

  const compareMutation = useMutation({
    mutationFn: () =>
      analyticsApi.compareLogicalDataset(selectedLdId, {
        group_by: groupBy,
        pivot_on: pivotOn,
        value_columns: valueColumns,
        aggregation,
        search: search || undefined,
        limit: 5000,
      }),
    onSuccess: (data) => setResult(data),
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

  const canRun = !!selectedLdId && groupBy.length > 0 && !!pivotOn && valueColumns.length > 0;

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
      <div className="card-glass">
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
              value={selectedLdId}
              onChange={(e) => {
                setSelectedLdId(e.target.value);
                setGroupBy([]);
                setValueColumns([]);
                setPivotOn("source_file");
                setResult(null);
              }}
              style={{
                background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                borderRadius: 8, padding: "7px 10px", color: "hsl(220 20% 90%)", fontSize: 12, outline: "none",
              }}
            >
              <option value="">— Select dataset —</option>
              {logicalDatasets.map((ld) => (
                <option key={ld.id} value={ld.id}>{ld.dataset_name}</option>
              ))}
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
                onChange={setGroupBy}
              />
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
              disabled={!selectedLdId}
              style={{
                background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                borderRadius: 8, padding: "7px 10px", color: "hsl(220 20% 90%)", fontSize: 12, outline: "none",
                minWidth: 160,
              }}
            >
              <option value="source_file">Source File (Vendor)</option>
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
              Values to Compare
            </label>
            <MultiSelect
              label="Select value columns"
              options={allColumns}
              selected={valueColumns}
              onChange={setValueColumns}
              exclude={[...groupBy, pivotOn]}
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

        {!selectedLdId && (
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
                  {sortedRows.map((row, ri) => (
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
                          return (
                            <td
                              key={`${pv}-${vc}`}
                              style={{
                                textAlign: "right",
                                borderLeft: vci === 0 ? "1px solid hsl(220 15% 16%)" : undefined,
                                color: val == null ? "hsl(220 10% 35%)" : isBest ? GREEN : "hsl(220 20% 88%)",
                                background: isBest ? "rgba(74,222,128,0.06)" : undefined,
                                fontWeight: isBest ? 700 : undefined,
                              }}
                            >
                              {val == null ? "—" : (
                                <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                                  {isBest && <Star size={10} color={GREEN} />}
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
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: 11, color: "hsl(220 10% 45%)", padding: "8px 14px" }}>
                {result.row_count} item{result.row_count !== 1 ? "s" : ""}
                {search ? ` matching "${search}"` : ""}
                {" "}· {result.pivot_values.length} {result.pivot_on === "source_file" ? "vendor(s)" : `${result.pivot_on} value(s)`}
                {" "}· aggregation: {result.aggregation}
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
