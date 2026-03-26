"use client";

import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "@/lib/api";
import { Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle, Sparkles, BarChart2, Layers } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type {
  DatasetProfileResponse,
  AnomalyResponse,
  TrendResponse,
  DatasetInsightResponse,
  PendingResponse,
  DatasetFileProfileResponse,
  DatasetFileAnomalyResponse,
  DatasetFileInsightResponse,
} from "@/types";

const PURPLE = "#a78bfa";
const BLUE = "#60a5fa";
const GREEN = "#4ade80";
const AMBER = "#fbbf24";
const RED = "#f87171";
const CHART_COLORS = [PURPLE, BLUE, GREEN, "#fb923c", "#f472b6", "#34d399"];

function isPending(data: unknown): data is PendingResponse {
  return typeof data === "object" && data !== null && (data as PendingResponse).status === "pending";
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 style={{
      fontSize: 11, fontWeight: 700, color: "hsl(220 10% 50%)",
      textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 14,
    }}>
      {children}
    </h4>
  );
}

function PendingCard({ message }: { message: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
      background: "hsl(220 15% 10%)", borderRadius: 10, border: "1px solid hsl(220 15% 18%)",
      color: "hsl(220 10% 50%)", fontSize: 13,
    }}>
      <Loader2 size={15} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
      {message}
    </div>
  );
}

/* ── AI Narrative Section ── */
function NarrativeSection({ logicalDatasetId }: { logicalDatasetId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["insight", logicalDatasetId],
    queryFn: () => analyticsApi.getInsight(logicalDatasetId),
  });

  if (isLoading) return <div style={{ marginBottom: 28 }}><PendingCard message="Loading AI insight…" /></div>;
  if (!data || isPending(data)) {
    return (
      <div style={{ marginBottom: 28 }}>
        <SectionTitle>AI Executive Summary</SectionTitle>
        <PendingCard message="Insight generation in progress. This runs automatically after mapping." />
      </div>
    );
  }

  const insight = data as DatasetInsightResponse;
  return (
    <div style={{ marginBottom: 28 }}>
      <SectionTitle>AI Executive Summary</SectionTitle>
      <div style={{
        padding: "18px 20px", borderRadius: 12,
        background: "linear-gradient(135deg, rgba(167,139,250,0.08), rgba(96,165,250,0.05))",
        border: "1px solid rgba(167,139,250,0.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Sparkles size={14} color={PURPLE} />
          <span style={{ fontSize: 12, fontWeight: 700, color: PURPLE }}>Powered by Gemini AI</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "hsl(220 10% 40%)" }}>
            {insight.generated_at ? new Date(insight.generated_at).toLocaleDateString() : ""}
          </span>
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {(insight.bullet_points ?? []).map((bp, i) => (
            <li key={i} style={{ display: "flex", gap: 10 }}>
              <span style={{ color: PURPLE, flexShrink: 0, marginTop: 2 }}>•</span>
              <span style={{ fontSize: 13, color: "hsl(220 15% 80%)", lineHeight: 1.5 }}>{bp}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ── Column Distribution Charts ── */
function ProfileSection({ logicalDatasetId }: { logicalDatasetId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["profile", logicalDatasetId],
    queryFn: () => analyticsApi.getProfile(logicalDatasetId),
  });

  if (isLoading) return <div style={{ marginBottom: 28 }}><PendingCard message="Loading column profiles…" /></div>;
  if (!data || isPending(data)) {
    return (
      <div style={{ marginBottom: 28 }}>
        <SectionTitle>Column Distributions</SectionTitle>
        <PendingCard message="Column profiling in progress." />
      </div>
    );
  }

  const profile = data as DatasetProfileResponse;
  const columnsWithTopValues = profile.columns
    .filter((c) => c.top_values && c.top_values.length > 0)
    .slice(0, 6);

  if (columnsWithTopValues.length === 0) {
    return (
      <div style={{ marginBottom: 28 }}>
        <SectionTitle>Column Distributions</SectionTitle>
        <p style={{ fontSize: 12, color: "hsl(220 10% 40%)" }}>No distribution data available.</p>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <SectionTitle>Column Distributions</SectionTitle>
      {/* Summary stats row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        {[
          { label: "Total Columns", value: profile.columns.length },
          { label: "Total Rows", value: (profile.columns[0]?.row_count ?? 0).toLocaleString() },
          { label: "High Nulls (>10%)", value: profile.columns.filter((c) => (c.null_pct ?? 0) > 0.1).length },
        ].map((stat) => (
          <div key={stat.label} style={{
            flex: "1 1 120px", padding: "10px 14px", borderRadius: 10,
            background: "hsl(220 15% 10%)", border: "1px solid hsl(220 15% 18%)",
          }}>
            <p style={{ fontSize: 10, color: "hsl(220 10% 46%)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{stat.label}</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: "hsl(220 20% 88%)" }}>{stat.value}</p>
          </div>
        ))}
      </div>
      {/* Distribution charts grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {columnsWithTopValues.map((col, idx) => (
          <div key={col.column_name} style={{
            padding: "14px 16px", borderRadius: 10,
            background: "hsl(220 15% 10%)", border: "1px solid hsl(220 15% 18%)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: "hsl(220 20% 85%)", marginBottom: 2 }}>{col.column_name}</p>
                <span style={{
                  fontSize: 10, padding: "1px 6px", borderRadius: 999,
                  background: "rgba(96,165,250,0.1)", color: BLUE, border: "1px solid rgba(96,165,250,0.2)",
                }}>
                  {col.data_type ?? "string"}
                </span>
              </div>
              {col.null_pct !== null && col.null_pct > 0 && (
                <span style={{ fontSize: 10, color: col.null_pct > 0.1 ? AMBER : "hsl(220 10% 45%)" }}>
                  {(col.null_pct * 100).toFixed(1)}% null
                </span>
              )}
            </div>
            {col.mean_value !== null && (
              <p style={{ fontSize: 10, color: "hsl(220 10% 45%)", marginBottom: 8 }}>
                μ {col.mean_value.toFixed(2)} · σ {(col.std_dev ?? 0).toFixed(2)}
              </p>
            )}
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={col.top_values} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="value" tick={{ fontSize: 9, fill: "hsl(220 10% 45%)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(220 10% 45%)" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(220 15% 14%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 8, fontSize: 11 }}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Bar dataKey="count" fill={CHART_COLORS[idx % CHART_COLORS.length]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Anomaly Table ── */
function AnomalySection({ logicalDatasetId }: { logicalDatasetId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["anomalies", logicalDatasetId],
    queryFn: () => analyticsApi.getAnomalies(logicalDatasetId, { limit: 50 }),
  });

  if (isLoading) return <div style={{ marginBottom: 28 }}><PendingCard message="Loading anomalies…" /></div>;
  if (!data || isPending(data)) {
    return (
      <div style={{ marginBottom: 28 }}>
        <SectionTitle>Flagged Anomalies</SectionTitle>
        <PendingCard message="Anomaly detection in progress." />
      </div>
    );
  }

  const anomalyData = data as AnomalyResponse;
  if (anomalyData.total_anomalies === 0) {
    return (
      <div style={{ marginBottom: 28 }}>
        <SectionTitle>Flagged Anomalies</SectionTitle>
        <div style={{
          padding: "16px 18px", borderRadius: 10,
          background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 16 }}>✓</span>
          <span style={{ fontSize: 13, color: GREEN }}>No anomalies detected. Data looks clean.</span>
        </div>
      </div>
    );
  }

  const severityStyle = (severity: string) => {
    if (severity === "high") return { background: "rgba(248,113,113,0.1)", color: RED, border: "1px solid rgba(248,113,113,0.3)" };
    if (severity === "medium") return { background: "rgba(251,191,36,0.08)", color: AMBER, border: "1px solid rgba(251,191,36,0.25)" };
    return { background: "rgba(96,165,250,0.06)", color: BLUE, border: "1px solid rgba(96,165,250,0.2)" };
  };

  const rowBg = (severity: string) => {
    if (severity === "high") return "rgba(239,68,68,0.07)";
    if (severity === "medium") return "rgba(251,191,36,0.05)";
    return "transparent";
  };

  return (
    <div style={{ marginBottom: 28 }}>
      <SectionTitle>Flagged Anomalies</SectionTitle>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <AlertTriangle size={13} color={AMBER} />
        <span style={{ fontSize: 12, color: "hsl(220 15% 70%)" }}>
          {anomalyData.total_anomalies} flagged values detected
        </span>
        {anomalyData.anomalies.length < anomalyData.total_anomalies && (
          <span style={{ fontSize: 11, color: "hsl(220 10% 42%)" }}>
            (showing {anomalyData.anomalies.length})
          </span>
        )}
      </div>
      <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid hsl(220 15% 16%)" }}>
        <table className="data-table">
          <thead>
            <tr>
              {["Column", "Value", "Method", "Reason", "Severity"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {anomalyData.anomalies.map((a) => (
              <tr key={a.id} style={{ background: rowBg(a.severity) }}>
                <td style={{ fontWeight: 600, color: "hsl(220 20% 80%)" }}>{a.column_name}</td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{a.value ?? "—"}</td>
                <td style={{ fontSize: 11, color: "hsl(220 10% 55%)" }}>
                  {a.method === "zscore" ? "Z-Score" : a.method === "iqr" ? "IQR" : "Rare Value"}
                </td>
                <td style={{ fontSize: 11, color: "hsl(220 15% 65%)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.reason ?? "—"}
                </td>
                <td>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                    textTransform: "capitalize", ...severityStyle(a.severity),
                  }}>
                    {a.severity}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Trend Charts ── */
function TrendSection({ logicalDatasetId }: { logicalDatasetId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["trends", logicalDatasetId],
    queryFn: () => analyticsApi.getTrends(logicalDatasetId),
  });

  if (isLoading) return <div style={{ marginBottom: 28 }}><PendingCard message="Loading trends…" /></div>;
  if (!data || isPending(data)) {
    return (
      <div style={{ marginBottom: 28 }}>
        <SectionTitle>Time-Series Trends</SectionTitle>
        <PendingCard message="Trend analysis in progress." />
      </div>
    );
  }

  const trendData = data as TrendResponse;
  if (!trendData.has_time_data || trendData.trends.length === 0) {
    return (
      <div style={{ marginBottom: 28 }}>
        <SectionTitle>Time-Series Trends</SectionTitle>
        <p style={{ fontSize: 12, color: "hsl(220 10% 40%)" }}>
          No timestamp column detected. Trend analysis requires a date or datetime column.
        </p>
      </div>
    );
  }

  const directionIcon = (dir: string) => {
    if (dir === "up") return <TrendingUp size={12} color={GREEN} />;
    if (dir === "down") return <TrendingDown size={12} color={RED} />;
    return <Minus size={12} color="hsl(220 10% 50%)" />;
  };

  return (
    <div style={{ marginBottom: 28 }}>
      <SectionTitle>Time-Series Trends</SectionTitle>
      <p style={{ fontSize: 12, color: "hsl(220 10% 46%)", marginBottom: 16 }}>
        Time column: <strong style={{ color: BLUE }}>{trendData.time_column}</strong> · monthly aggregation
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {trendData.trends.slice(0, 6).map((trend, idx) => (
          <div key={trend.value_column} style={{
            padding: "14px 16px", borderRadius: 10,
            background: "hsl(220 15% 10%)", border: "1px solid hsl(220 15% 18%)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: "hsl(220 20% 85%)", marginBottom: 3 }}>{trend.value_column}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  {directionIcon(trend.direction)}
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: trend.direction === "up" ? GREEN : trend.direction === "down" ? RED : "hsl(220 10% 50%)",
                  }}>
                    {trend.direction === "up" ? "Upward" : trend.direction === "down" ? "Downward" : "Flat"} trend
                  </span>
                </div>
              </div>
              {trend.r_squared !== null && (
                <span style={{ fontSize: 10, color: "hsl(220 10% 45%)" }}>
                  R² {trend.r_squared.toFixed(2)}
                </span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={trend.series_data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 18%)" vertical={false} />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 9, fill: "hsl(220 10% 45%)" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 9, fill: "hsl(220 10% 45%)" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(220 15% 14%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 8, fontSize: 11 }}
                  cursor={{ stroke: "hsl(220 15% 28%)", strokeWidth: 1 }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── File-Level Insights Section ── */
function FileInsightsSection({ datasetId }: { datasetId: string }) {
  const { data: insightData, isLoading: insightLoading } = useQuery({
    queryKey: ["file-insight", datasetId],
    queryFn: () => analyticsApi.getFileInsight(datasetId),
  });
  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: ["file-profile", datasetId],
    queryFn: () => analyticsApi.getFileProfile(datasetId),
  });
  const { data: anomalyData, isLoading: anomalyLoading } = useQuery({
    queryKey: ["file-anomalies", datasetId],
    queryFn: () => analyticsApi.getFileAnomalies(datasetId, { limit: 30 }),
  });

  const severityStyle = (severity: string) => {
    if (severity === "high") return { background: "rgba(248,113,113,0.1)", color: RED, border: "1px solid rgba(248,113,113,0.3)" };
    if (severity === "medium") return { background: "rgba(251,191,36,0.08)", color: AMBER, border: "1px solid rgba(251,191,36,0.25)" };
    return { background: "rgba(96,165,250,0.06)", color: BLUE, border: "1px solid rgba(96,165,250,0.2)" };
  };

  const rowBg = (severity: string) => {
    if (severity === "high") return "rgba(239,68,68,0.06)";
    if (severity === "medium") return "rgba(245,158,11,0.05)";
    return "transparent";
  };

  // Summary stats
  const profile = profileData && !isPending(profileData) ? (profileData as DatasetFileProfileResponse) : null;
  const anomalies = anomalyData && !isPending(anomalyData) ? (anomalyData as DatasetFileAnomalyResponse) : null;
  const insight = insightData && !isPending(insightData) ? (insightData as DatasetFileInsightResponse) : null;

  return (
    <div style={{ marginBottom: 0 }}>
      {/* AI Narrative */}
      {insightLoading ? (
        <div style={{ marginBottom: 16 }}><PendingCard message="Generating file insight…" /></div>
      ) : !insight ? (
        <div style={{ marginBottom: 16 }}><PendingCard message="File analysis runs automatically after upload." /></div>
      ) : (
        <div style={{
          padding: "14px 16px", borderRadius: 10, marginBottom: 16,
          background: "linear-gradient(135deg, rgba(96,165,250,0.07), rgba(74,222,128,0.04))",
          border: "1px solid rgba(96,165,250,0.2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <Sparkles size={12} color={BLUE} />
            <span style={{ fontSize: 11, fontWeight: 700, color: BLUE }}>File AI Summary</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "hsl(220 10% 40%)" }}>
              {insight.generated_at ? new Date(insight.generated_at).toLocaleDateString() : ""}
            </span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {(insight.bullet_points ?? []).map((bp, i) => (
              <li key={i} style={{ display: "flex", gap: 8 }}>
                <span style={{ color: BLUE, flexShrink: 0, marginTop: 2 }}>•</span>
                <span style={{ fontSize: 12, color: "hsl(220 15% 78%)", lineHeight: 1.5 }}>{bp}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick stats row */}
      {(profileLoading || profile) && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          {profileLoading ? (
            <PendingCard message="Loading file stats…" />
          ) : profile ? (
            <>
              {[
                { label: "Rows", value: (profile.columns[0]?.row_count ?? 0).toLocaleString() },
                { label: "Columns", value: profile.columns.length },
                { label: "High Nulls", value: profile.columns.filter(c => (c.null_pct ?? 0) > 0.1).length },
                { label: "Anomalies", value: anomalyLoading ? "…" : (anomalies?.total_anomalies ?? 0) },
              ].map(stat => (
                <div key={stat.label} style={{
                  flex: "1 1 80px", padding: "8px 12px", borderRadius: 8,
                  background: "hsl(220 15% 10%)", border: "1px solid hsl(220 15% 18%)",
                }}>
                  <p style={{ fontSize: 9, color: "hsl(220 10% 46%)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>{stat.label}</p>
                  <p style={{ fontSize: 16, fontWeight: 700, color: "hsl(220 20% 88%)" }}>{stat.value}</p>
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}

      {/* Anomaly table (high/medium only, capped at 10) */}
      {anomalyLoading ? null : anomalies && anomalies.total_anomalies > 0 ? (
        <div>
          <p style={{ fontSize: 10, fontWeight: 600, color: "hsl(220 10% 42%)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
            Top Anomalies ({anomalies.total_anomalies} total)
          </p>
          <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid hsl(220 15% 18%)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "hsl(220 15% 11%)" }}>
                  {["Column", "Value", "Method", "Severity"].map(h => (
                    <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, color: "hsl(220 10% 48%)", fontSize: 10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {anomalies.anomalies
                  .filter(a => a.severity !== "low")
                  .slice(0, 10)
                  .map((a) => (
                  <tr key={a.id} style={{ background: rowBg(a.severity), borderTop: "1px solid hsl(220 15% 15%)" }}>
                    <td style={{ padding: "6px 10px", color: "hsl(220 20% 80%)", fontFamily: "monospace" }}>{a.column_name}</td>
                    <td style={{ padding: "6px 10px", color: "hsl(220 20% 75%)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.value}</td>
                    <td style={{ padding: "6px 10px", color: "hsl(220 10% 50%)" }}>{a.method}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, fontWeight: 700, ...severityStyle(a.severity) }}>
                        {a.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Main InsightsPanel ── */
export default function InsightsPanel({
  logicalDatasetId,
  datasetName,
  datasetId,
}: {
  logicalDatasetId: string;
  datasetName?: string;
  datasetId?: string;
}) {
  return (
    <div className="fade-in">
      {datasetName && (
        <div style={{
          marginBottom: 24,
          paddingBottom: 18,
          borderBottom: "1px solid hsl(220 15% 16%)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
            <Layers size={13} color={PURPLE} />
            <span style={{ fontSize: 10, fontWeight: 600, color: "hsl(220 10% 42%)", textTransform: "uppercase", letterSpacing: "0.6px" }}>
              Logical Dataset
            </span>
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: "hsl(220 20% 92%)", margin: 0 }}>
            {datasetName}
          </h3>
          <p style={{ fontSize: 11, color: "hsl(220 10% 40%)", marginTop: 5 }}>
            Analysis covers all source files merged into this dataset
          </p>
        </div>
      )}
      {/* ── This File section (only in source-file view) ── */}
      {datasetId && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ height: 1, flex: 1, background: "hsl(220 15% 18%)" }} />
            <span style={{
              fontSize: 10, fontWeight: 700, color: BLUE,
              textTransform: "uppercase", letterSpacing: "0.7px",
              padding: "3px 10px", borderRadius: 999,
              background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)",
            }}>
              This File
            </span>
            <div style={{ height: 1, flex: 1, background: "hsl(220 15% 18%)" }} />
          </div>
          <FileInsightsSection datasetId={datasetId} />
        </div>
      )}

      {/* ── Full Dataset section divider (only shown when file section is visible) ── */}
      {datasetId && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 22 }}>
          <div style={{ height: 1, flex: 1, background: "hsl(220 15% 18%)" }} />
          <span style={{
            fontSize: 10, fontWeight: 700, color: PURPLE,
            textTransform: "uppercase", letterSpacing: "0.7px",
            padding: "3px 10px", borderRadius: 999,
            background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)",
          }}>
            Full Dataset
          </span>
          <div style={{ height: 1, flex: 1, background: "hsl(220 15% 18%)" }} />
        </div>
      )}

      <NarrativeSection logicalDatasetId={logicalDatasetId} />
      <ProfileSection logicalDatasetId={logicalDatasetId} />
      <AnomalySection logicalDatasetId={logicalDatasetId} />
      <TrendSection logicalDatasetId={logicalDatasetId} />
    </div>
  );
}
