"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { analyticsApi, ingestApi } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import Header from "@/components/layout/Header";
import type { MetricDefinition, DiscoveredMetric, QueryResult } from "@/types";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Play, Loader2, Plus, Zap, Save, TrendingUp,
  CheckSquare, Square, BarChart2, Sparkles, ChevronRight, ArrowLeftRight
} from "lucide-react";
import QuoteComparison from "@/components/QuoteComparison";

// Monaco editor lazy-loaded (heavy)
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const PURPLE = "#a78bfa";
const BLUE = "#60a5fa";
const GREEN = "#4ade80";
const CHART_COLORS = [PURPLE, BLUE, GREEN, "#fb923c", "#f472b6", "#34d399"];

function ResultsTable({ result }: { result: QueryResult }) {
  if (!result.rows?.length) {
    return <p style={{ textAlign: "center", color: "hsl(220 10% 45%)", fontSize: 13, padding: "24px 0" }}>No rows returned.</p>;
  }
  return (
    <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid hsl(220 15% 16%)", marginTop: 12 }}>
      <table className="data-table">
        <thead>
          <tr>{result.columns.map((c, i) => <th key={`${c}-${i}`}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              {result.columns.map((c, j) => (
                <td key={`${c}-${j}`} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {String(row[c] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: "hsl(220 10% 45%)", padding: "8px 14px" }}>
        {result.row_count} row{result.row_count !== 1 ? "s" : ""} returned
      </p>
    </div>
  );
}

function ResultsChart({ result }: { result: QueryResult }) {
  if (!result.rows?.length || result.columns.length < 2) return null;
  const numericCol = result.columns.find((c) =>
    result.rows.some((r) => typeof r[c] === "number" || !isNaN(Number(r[c])))
  );
  const labelCol = result.columns[0];
  if (!numericCol) return null;

  const data = result.rows.slice(0, 20).map((row) => ({
    name: String(row[labelCol] ?? ""),
    value: Number(row[numericCol]),
  }));

  return (
    <div style={{ marginTop: 20 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
        Data Visualization
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barSize={24}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 16%)" />
          <XAxis dataKey="name" tick={{ fill: "hsl(220 10% 50%)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "hsl(220 10% 50%)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "hsl(220 15% 8%)", border: "1px solid hsl(220 15% 18%)", borderRadius: 8, color: "hsl(220 20% 90%)" }}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function AnalyticsPage() {
  const { productId } = useAppStore();
  const qc = useQueryClient();

  const [sql, setSql] = useState("SELECT * FROM your_table LIMIT 50;");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [activeTab, setActiveTab] = useState<"query" | "metrics" | "compare">("query");

  // Metrics form
  const [metricName, setMetricName] = useState("");
  const [metricExpr, setMetricExpr] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [selectedTargetType, setSelectedTargetType] = useState<"logical" | "single">("logical");
  
  const currentTargetValue = selectedTargetId ? `${selectedTargetType}:${selectedTargetId}` : "";

  // Discovered metrics selection
  const [discovered, setDiscovered] = useState<DiscoveredMetric[]>([]);
  const [selectedDiscovered, setSelectedDiscovered] = useState<Set<number>>(new Set());

  // Metric results
  const [metricResults, setMetricResults] = useState<Record<number, unknown>>({});

  const { data: logicalDatasets } = useQuery({
    queryKey: ["logical-datasets", productId],
    queryFn: () => ingestApi.listLogicalDatasets(productId),
    enabled: !!productId,
  });

  const { data: datasets } = useQuery({
    queryKey: ["datasets", productId],
    queryFn: () => ingestApi.listDatasets(productId),
    enabled: !!productId,
  });

  const { data: metrics, isLoading: loadingMetrics } = useQuery({
    queryKey: ["metrics", productId],
    queryFn: () => analyticsApi.listMetrics(productId),
    enabled: !!productId,
  });

  const queryMutation = useMutation({
    mutationFn: (overrideSql?: string) => analyticsApi.query({ product_id: productId, sql_query: overrideSql || sql }),
    onSuccess: (data) => {
      setQueryResult(data);
      toast.success(`Query returned ${data.row_count} rows`);
    },
    onError: () => toast.error("Query failed — check your SQL syntax"),
  });

  const createMetricMutation = useMutation({
    mutationFn: () =>
      analyticsApi.createMetric({
        product_id: productId,
        metric_name: metricName,
        target_id: selectedTargetId,
        target_type: selectedTargetType,
        sql_expression: metricExpr,
      }),
    onSuccess: () => {
      toast.success("Metric created");
      qc.invalidateQueries({ queryKey: ["metrics", productId] });
      setMetricName(""); setMetricExpr("");
    },
    onError: () => toast.error("Failed to create metric"),
  });

  const runMetricMutation = useMutation({
    mutationFn: (id: number) => analyticsApi.runMetric(id),
    onSuccess: (data, id) => {
      setMetricResults((prev) => ({ ...prev, [id]: data.result }));
      toast.success(`Metric "${data.metric_name}" computed`);
    },
    onError: () => toast.error("Failed to run metric"),
  });

  const discoverMutation = useMutation({
    mutationFn: () => analyticsApi.discoverMetrics(selectedTargetId, selectedTargetType),
    onSuccess: (data) => {
      setDiscovered(data);
      setSelectedDiscovered(new Set(data.map((_, i) => i)));
      toast.success(`${data.length} metrics discovered by AI`);
    },
    onError: () => toast.error("Discovery failed"),
  });

  const bulkSaveMutation = useMutation({
    mutationFn: () =>
      analyticsApi.bulkSaveMetrics({
        product_id: productId,
        target_id: selectedTargetId,
        target_type: selectedTargetType,
        metrics: discovered.filter((_, i) => selectedDiscovered.has(i)),
      }),
    onSuccess: (data: any) => {
      toast.success(`${data.saved_count} metrics saved`);
      qc.invalidateQueries({ queryKey: ["metrics", productId] });
      setDiscovered([]);
    },
    onError: () => toast.error("Bulk save failed"),
  });

  return (
    <>
      <Header title="Analytics" subtitle="Write SQL queries, define metrics, and discover insights with AI" />
      <div className="page-body">
        {/* Tab bar */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "hsl(220 15% 10%)", borderRadius: 10, padding: 4, width: "fit-content" }}>
          {([
            { key: "query", label: "SQL Query" },
            { key: "metrics", label: "Metrics & AI" },
            { key: "compare", label: "Compare", icon: <ArrowLeftRight size={12} style={{ display: "inline", marginRight: 5 }} /> },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: "7px 20px", borderRadius: 7, border: "none", cursor: "pointer",
                fontWeight: 600, fontSize: 13,
                background: activeTab === t.key ? "linear-gradient(135deg, rgba(167,139,250,0.2), rgba(96,165,250,0.15))" : "transparent",
                color: activeTab === t.key ? PURPLE : "hsl(220 10% 50%)",
                transition: "all 0.12s",
                display: "flex", alignItems: "center",
              }}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {activeTab === "query" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20, maxWidth: 1100 }}>
            <div className="card-glass">
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "hsl(220 10% 55%)", marginBottom: 6 }}>
                  Quick Target Selection (Auto-fills SQL)
                </label>
                <div style={{ maxWidth: 400 }}>
                  <select
                    value={currentTargetValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        setSelectedTargetId("");
                        return;
                      }
                      const [type, id] = val.split(":");
                      setSelectedTargetId(id);
                      setSelectedTargetType(type as "logical" | "single");
                      
                      if (type === "logical") {
                        const ld = logicalDatasets?.find(d => d.id === id);
                        if (ld?.table_name) setSql(`SELECT * FROM "${ld.table_name}" LIMIT 50;`);
                      } else {
                        const ds = datasets?.find(d => d.id === id);
                        if (ds?.table_name) setSql(`SELECT * FROM "${ds.table_name}" LIMIT 50;`);
                      }
                    }}
                    style={{
                      width: "100%", background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                      borderRadius: 8, padding: "8px 12px", color: "hsl(220 20% 90%)", fontSize: 13, outline: "none",
                    }}
                  >
                    <option value="">— Select data target —</option>
                    {logicalDatasets && logicalDatasets.length > 0 && (
                      <optgroup label="Schema Groups (Combined)">
                        {logicalDatasets.map((ld) => (
                          <option key={`logical:${ld.id}`} value={`logical:${ld.id}`}>{ld.dataset_name}</option>
                        ))}
                      </optgroup>
                    )}
                    {datasets && datasets.length > 0 && (
                      <optgroup label="Single Files (Raw)">
                        {datasets.map((ds) => (
                          <option key={`single:${ds.id}`} value={`single:${ds.id}`}>{ds.original_filename}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>SQL Editor</h3>
                <button
                  className="btn-gradient"
                  onClick={() => queryMutation.mutate(sql)}
                  disabled={queryMutation.isPending || !sql.trim()}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px" }}
                >
                  {queryMutation.isPending ? <Loader2 size={13} /> : <Play size={13} />}
                  Run Query
                </button>
              </div>
              <div className="sql-editor-wrapper" style={{ height: 220 }}>
                <MonacoEditor
                  height="220px"
                  language="sql"
                  theme="vs-dark"
                  value={sql}
                  onChange={(v) => setSql(v ?? "")}
                  options={{
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    padding: { top: 12, bottom: 12 },
                    lineNumbers: "on",
                    wordWrap: "on",
                    automaticLayout: true,
                  }}
                />
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                {[
                  "SELECT * FROM your_table LIMIT 50;",
                  "SELECT COUNT(*) as total FROM your_table;",
                  "SELECT column, COUNT(*) as cnt FROM your_table GROUP BY column ORDER BY cnt DESC;",
                ].map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setSql(q)}
                    style={{
                      padding: "4px 10px", borderRadius: 6, fontSize: 11,
                      background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 20%)",
                      color: "hsl(220 10% 55%)", cursor: "pointer",
                    }}
                  >
                    {i === 0 ? "SELECT *" : i === 1 ? "COUNT" : "GROUP BY"}
                  </button>
                ))}
              </div>
            </div>

            {queryResult && (
              <div className="card-glass fade-in">
                <ResultsTable result={queryResult} />
                <ResultsChart result={queryResult} />
              </div>
            )}
          </div>
        )}

        {activeTab === "metrics" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20, maxWidth: 1100 }}>
            {/* LEFT — Metrics list + results */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Define metric */}
              <div className="card-glass">
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
                  <Plus size={14} style={{ display: "inline", marginRight: 6 }} />Define Metric
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <input
                      value={metricName}
                      onChange={(e) => setMetricName(e.target.value)}
                      placeholder="Metric name (e.g. total_revenue)"
                      style={{
                        background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                        borderRadius: 8, padding: "8px 12px", color: "hsl(220 20% 90%)", fontSize: 13, outline: "none",
                      }}
                    />
                    <select
                      value={currentTargetValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) { setSelectedTargetId(""); return; }
                        const [type, id] = val.split(":");
                        setSelectedTargetId(id); setSelectedTargetType(type as "logical" | "single");
                      }}
                      style={{
                        background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                        borderRadius: 8, padding: "8px 12px", color: "hsl(220 20% 90%)", fontSize: 13, outline: "none",
                      }}
                    >
                      <option value="">— Select data target —</option>
                      {logicalDatasets && logicalDatasets.length > 0 && (
                        <optgroup label="Schema Groups">
                          {logicalDatasets.map((ld) => (
                            <option key={`logical:${ld.id}`} value={`logical:${ld.id}`}>{ld.dataset_name}</option>
                          ))}
                        </optgroup>
                      )}
                      {datasets && datasets.length > 0 && (
                        <optgroup label="Single Files">
                          {datasets.map((ds) => (
                            <option key={`single:${ds.id}`} value={`single:${ds.id}`}>{ds.original_filename}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <input
                    value={metricExpr}
                    onChange={(e) => setMetricExpr(e.target.value)}
                    placeholder="SQL expression (e.g. SUM(revenue))"
                    style={{
                      background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                      borderRadius: 8, padding: "8px 12px", color: "hsl(220 20% 90%)", fontSize: 13,
                      outline: "none", fontFamily: "monospace",
                    }}
                  />
                  <button
                    className="btn-gradient"
                    onClick={() => createMetricMutation.mutate()}
                    disabled={!metricName || !metricExpr || !selectedTargetId || createMetricMutation.isPending}
                    style={{ alignSelf: "flex-start", padding: "7px 16px", display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {createMetricMutation.isPending ? <Loader2 size={13} /> : <Plus size={13} />}
                    Create Metric
                  </button>
                </div>
              </div>

              {/* Saved metrics */}
              <div className="card-glass">
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
                  <TrendingUp size={14} style={{ display: "inline", marginRight: 6 }} />Saved Metrics
                </h3>
                {loadingMetrics ? (
                  <div style={{ textAlign: "center", padding: 20 }}><Loader2 size={16} /></div>
                ) : metrics && metrics.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {metrics.map((m: MetricDefinition, i) => (
                      <div key={m.id || i} style={{
                        padding: "14px 16px", background: "hsl(220 15% 10%)",
                        borderRadius: 12, border: "1px solid hsl(220 15% 18%)",
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 14, fontWeight: 600 }}>{m.metric_name}</p>
                          <code style={{ fontSize: 11, color: "#a78bfa", display: "block", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.sql_expression}
                          </code>
                          {m.id !== undefined && metricResults[m.id] !== undefined && (
                            <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 6 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>
                                Result: {String(metricResults[m.id!])}
                              </span>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            if (!m.id) return;
                            let tableName = "";
                            if (m.target_type === "logical") {
                              const ld = logicalDatasets?.find(d => d.id === m.target_id);
                              tableName = ld?.table_name || "";
                            } else {
                              const ds = datasets?.find(d => d.id === m.target_id);
                              tableName = ds?.table_name || "";
                            }
                            if (!tableName) {
                              toast.error("Target dataset table not found. It may have been deleted.");
                              return;
                            }
                            const fullQuery = `SELECT ${m.sql_expression}\nAS "${m.metric_name}"\nFROM "${tableName}";`;
                            setSql(fullQuery);
                            setActiveTab("query");
                            queryMutation.mutate(fullQuery);
                          }}
                          disabled={queryMutation.isPending}
                          style={{
                            display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                            background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)",
                            borderRadius: 8, cursor: "pointer", color: PURPLE, fontSize: 12, fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          <Play size={11} /> View SQL
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ textAlign: "center", color: "hsl(220 10% 45%)", fontSize: 13, padding: "24px 0" }}>
                    No metrics yet. Define one above.
                  </p>
                )}
              </div>
            </div>

            {/* RIGHT — AI Discovery */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="card-glass glow-pulse">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <Sparkles size={16} color={PURPLE} />
                  <h3 style={{ fontSize: 14, fontWeight: 600 }}>AI Metric Discovery</h3>
                </div>
                <p style={{ fontSize: 12, color: "hsl(220 10% 55%)", marginBottom: 14, lineHeight: 1.5 }}>
                  Use Gemini AI to automatically discover meaningful business metrics for your logical dataset.
                </p>
                <select
                  value={currentTargetValue}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) { setSelectedTargetId(""); return; }
                    const [type, id] = val.split(":");
                    setSelectedTargetId(id); setSelectedTargetType(type as "logical" | "single");
                  }}
                  style={{
                    width: "100%", background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
                    borderRadius: 8, padding: "8px 12px", color: "hsl(220 20% 90%)", fontSize: 13,
                    outline: "none", marginBottom: 10,
                  }}
                >
                  <option value="">— Select data target —</option>
                  {logicalDatasets && logicalDatasets.length > 0 && (
                    <optgroup label="Schema Groups">
                      {logicalDatasets.map((ld) => (
                        <option key={`logical:${ld.id}`} value={`logical:${ld.id}`}>{ld.dataset_name}</option>
                      ))}
                    </optgroup>
                  )}
                  {datasets && datasets.length > 0 && (
                    <optgroup label="Single Files">
                      {datasets.map((ds) => (
                        <option key={`single:${ds.id}`} value={`single:${ds.id}`}>{ds.original_filename}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button
                  className="btn-gradient"
                  onClick={() => selectedTargetId && discoverMutation.mutate()}
                  disabled={!selectedTargetId || discoverMutation.isPending}
                  style={{ width: "100%", padding: "8px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                >
                  {discoverMutation.isPending ? <Loader2 size={14} /> : <Zap size={14} />}
                  Discover Metrics
                </button>
              </div>

              {discovered.length > 0 && (
                <div className="card-glass fade-in">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600 }}>
                      {discovered.length} Suggested Metrics
                    </h3>
                    <button
                      onClick={() => {
                        const all = new Set(discovered.map((_, i) => i));
                        setSelectedDiscovered(selectedDiscovered.size === discovered.length ? new Set() : all);
                      }}
                      style={{ fontSize: 11, color: PURPLE, background: "none", border: "none", cursor: "pointer" }}
                    >
                      {selectedDiscovered.size === discovered.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                    {discovered.map((m, i) => (
                      <div
                        key={i}
                        className={`metric-card ${selectedDiscovered.has(i) ? "selected" : ""}`}
                        onClick={() => setSelectedDiscovered((prev) => {
                          const next = new Set(prev);
                          next.has(i) ? next.delete(i) : next.add(i);
                          return next;
                        })}
                        style={{ cursor: "pointer" }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          {selectedDiscovered.has(i)
                            ? <CheckSquare size={14} color={PURPLE} style={{ flexShrink: 0, marginTop: 2 }} />
                            : <Square size={14} color="hsl(220 10% 45%)" style={{ flexShrink: 0, marginTop: 2 }} />
                          }
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{m.metric_name}</p>
                            <code style={{ fontSize: 11, color: BLUE }}>{m.sql_expression}</code>
                            {m.description && (
                              <p style={{ fontSize: 11, color: "hsl(220 10% 50%)", marginTop: 4 }}>{m.description}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    className="btn-gradient"
                    onClick={() => bulkSaveMutation.mutate()}
                    disabled={selectedDiscovered.size === 0 || !selectedTargetId || bulkSaveMutation.isPending}
                    style={{ width: "100%", padding: "8px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                  >
                    {bulkSaveMutation.isPending ? <Loader2 size={13} /> : <Save size={13} />}
                    Save {selectedDiscovered.size} Selected Metrics
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "compare" && (
          <QuoteComparison
            productId={productId}
            logicalDatasets={logicalDatasets ?? []}
          />
        )}
      </div>
    </>
  );
}
