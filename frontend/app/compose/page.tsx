"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { compositeApi, ingestApi } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import Header from "@/components/layout/Header";
import { toast } from "sonner";
import type { CompositeViewSource, CompositeView } from "@/types";
import { Plus, Play, Trash2, Link2, Loader2, Database, X } from "lucide-react";

export default function ComposePage() {
  const { productId, composeDraft, setComposeDraft, resetComposeDraft } = useAppStore();
  const { viewName, description, sources } = composeDraft;
  const qc = useQueryClient();

  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null);
  const [queryingSql, setQueryingSql] = useState("");

  const { data: logicalDatasets, isLoading: loadingLDs } = useQuery({
    queryKey: ["logical-datasets", productId],
    queryFn: () => ingestApi.listLogicalDatasets(productId),
    enabled: !!productId,
  });

  const { data: views, isLoading: loadingViews } = useQuery({
    queryKey: ["composite-views", productId],
    queryFn: () => compositeApi.list(productId),
    enabled: !!productId,
  });

  const createMutation = useMutation({
    mutationFn: () => compositeApi.create({ product_id: productId, view_name: viewName, description, sources: sources as CompositeViewSource[] }),
    onSuccess: () => {
      toast.success("Composite view created!");
      qc.invalidateQueries({ queryKey: ["composite-views", productId] });
      resetComposeDraft();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to create view"),
  });

  const deleteMutation = useMutation({
    mutationFn: compositeApi.delete,
    onSuccess: () => {
      toast.success("View deleted");
      qc.invalidateQueries({ queryKey: ["composite-views", productId] });
      if (selectedViewId) setSelectedViewId(null);
    },
  });

  const handleQuery = async (viewId: string) => {
    setSelectedViewId(viewId);
    setQueryResult(null);
    setQueryingSql("");
    try {
      const result = await compositeApi.query(viewId);
      setQueryResult(result);
      setQueryingSql((result as { sql?: string }).sql || "");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Query failed");
    }
  };

  const addSource = () => {
    setComposeDraft({
      sources: [
        ...sources,
        { dataset_type: "dynamic", dataset_id: "", join_key: "", alias: `t${sources.length + 1}`, dataset_name: "" },
      ],
    });
  };

  const removeSource = (i: number) => {
    setComposeDraft({ sources: sources.filter((_, idx) => idx !== i) });
  };

  const updateSource = (i: number, field: keyof CompositeViewSource, val: string) => {
    const next = [...sources];
    (next[i] as Record<string, string>)[field] = val;
    // Auto-fill name when dataset_id changes
    if (field === "dataset_id" && logicalDatasets) {
      const ld = logicalDatasets.find((d) => d.id === val);
      if (ld) next[i].dataset_name = ld.dataset_name;
    }
    setComposeDraft({ sources: next });
  };

  return (
    <>
      <Header title="Compose" subtitle="Join multiple schemas into a unified cross-dataset view" />
      <div className="page-body">
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20, maxWidth: 1300 }}>
          {/* LEFT — Builder + Saved Views */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Builder card */}
            <div className="card-glass">
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "hsl(220 10% 60%)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
                New Composite View
              </h3>

              <input
                placeholder="View name (e.g. Asset Overview)"
                value={viewName}
                onChange={(e) => setComposeDraft({ viewName: e.target.value })}
                style={{ width: "100%", marginBottom: 8, padding: "8px 12px", borderRadius: 8, border: "1px solid hsl(220 15% 22%)", background: "hsl(220 15% 8%)", color: "inherit", fontSize: 13, boxSizing: "border-box" }}
              />
              <input
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setComposeDraft({ description: e.target.value })}
                style={{ width: "100%", marginBottom: 14, padding: "8px 12px", borderRadius: 8, border: "1px solid hsl(220 15% 22%)", background: "hsl(220 15% 8%)", color: "inherit", fontSize: 13, boxSizing: "border-box" }}
              />

              <div style={{ marginBottom: 10 }}>
                {sources.map((src, i) => (
                  <div key={i} style={{ background: "hsl(220 15% 9%)", border: "1px solid hsl(220 15% 19%)", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(220 10% 55%)" }}>Source {i + 1}</span>
                      <button onClick={() => removeSource(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171" }}><X size={13} /></button>
                    </div>
                    <select
                      value={src.dataset_id}
                      onChange={(e) => updateSource(i, "dataset_id", e.target.value)}
                      style={{ width: "100%", marginBottom: 6, padding: "6px 10px", borderRadius: 7, border: "1px solid hsl(220 15% 22%)", background: "hsl(220 15% 10%)", color: "inherit", fontSize: 12 }}
                    >
                      <option value="">— Select dataset —</option>
                      {(logicalDatasets ?? []).map((ld) => (
                        <option key={ld.id} value={ld.id}>{ld.dataset_name}</option>
                      ))}
                    </select>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        placeholder="Join key (e.g. asset_id)"
                        value={src.join_key}
                        onChange={(e) => updateSource(i, "join_key", e.target.value)}
                        style={{ flex: 1, padding: "6px 10px", borderRadius: 7, border: "1px solid hsl(220 15% 22%)", background: "hsl(220 15% 10%)", color: "inherit", fontSize: 12 }}
                      />
                      <input
                        placeholder="Alias"
                        value={src.alias}
                        onChange={(e) => updateSource(i, "alias", e.target.value)}
                        style={{ width: 60, padding: "6px 8px", borderRadius: 7, border: "1px solid hsl(220 15% 22%)", background: "hsl(220 15% 10%)", color: "inherit", fontSize: 12 }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={addSource}
                style={{ width: "100%", padding: "7px 0", borderRadius: 8, border: "1px dashed hsl(220 15% 28%)", background: "transparent", color: "hsl(220 10% 55%)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 12 }}
              >
                <Plus size={13} /> Add Source
              </button>

              <button
                className="btn-gradient"
                disabled={!viewName || sources.length < 2 || createMutation.isPending}
                onClick={() => createMutation.mutate()}
                style={{ width: "100%", padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                <Link2 size={13} /> Save View
              </button>
            </div>

            {/* Saved views list */}
            <div className="card-glass">
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "hsl(220 10% 60%)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
                Saved Views
              </h3>
              {loadingViews ? <Loader2 size={14} /> : (views ?? []).length === 0 ? (
                <p style={{ fontSize: 12, color: "hsl(220 10% 45%)" }}>No views yet. Create one above.</p>
              ) : (views ?? []).map((v: CompositeView) => (
                <div
                  key={v.id}
                  style={{
                    padding: "9px 12px", borderRadius: 9, marginBottom: 6,
                    border: `1px solid ${selectedViewId === v.id ? "rgba(167,139,250,0.4)" : "hsl(220 15% 18%)"}`,
                    background: selectedViewId === v.id ? "rgba(167,139,250,0.1)" : "hsl(220 15% 10%)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(220 20% 86%)" }}>{v.view_name}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => handleQuery(v.id)}
                        style={{ background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 6, padding: "3px 8px", cursor: "pointer", color: "#60a5fa", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
                      >
                        <Play size={10} /> Run
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(v.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171" }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: 10, color: "hsl(220 10% 48%)", marginTop: 3 }}>
                    {v.sources.length} source{v.sources.length !== 1 ? "s" : ""}: {v.sources.map((s) => s.dataset_name || s.alias).join(" ⋈ ")}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — Query result */}
          <div className="card-glass" style={{ overflowX: "auto" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Cross-Dataset Query Result</h3>
            {queryingSql && (
              <pre style={{ fontSize: 11, background: "hsl(220 15% 8%)", padding: 12, borderRadius: 8, marginBottom: 16, overflowX: "auto", color: "#93c5fd", border: "1px solid hsl(220 15% 18%)" }}>
                {queryingSql}
              </pre>
            )}
            {!queryResult ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "hsl(220 10% 40%)" }}>
                <Link2 size={40} style={{ margin: "0 auto 14px", display: "block", opacity: 0.3 }} />
                <p style={{ fontSize: 14 }}>Run a saved composite view to see cross-dataset results</p>
              </div>
            ) : (
              <>
                <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid hsl(220 15% 16%)" }}>
                  <table className="data-table">
                    <thead>
                      <tr>{queryResult.columns.map((c, i) => <th key={c || i}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {queryResult.rows.map((row, i) => (
                        <tr key={i}>
                          {queryResult.columns.map((c, j) => (
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
                  {queryResult.rows.length} rows · {queryResult.columns.length} columns
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
