"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ingestApi, mapApi, schemasApi } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import Header from "@/components/layout/Header";
import type { DatasetMetadata, TargetSchemaResponse, ColumnMapping } from "@/types";
import {
  Loader2, Wand2, ArrowRight, CheckCircle2, Plus,
  Trash2, RefreshCw, ChevronDown, Send, AlertTriangle
} from "lucide-react";

export default function MappingPage() {
  const { productId, mappingDraft, setMappingDraft, resetMappingDraft } = useAppStore();
  const { selectedDatasetId, selectedSchemaId, columnMappings } = mappingDraft;
  const qc = useQueryClient();

  // Lookups
  const { data: datasets, isLoading: loadingDatasets } = useQuery({
    queryKey: ["datasets", productId],
    queryFn: () => ingestApi.listDatasets(productId),
    enabled: !!productId,
  });

  const { data: schemas, isLoading: loadingSchemas } = useQuery({
    queryKey: ["schemas", productId],
    queryFn: () => ingestApi.listAllSchemas(productId),
    enabled: !!productId,
  });

  const selectedDataset = datasets?.find(d => d.id === selectedDatasetId) || null;
  const selectedSchema = schemas?.find(s => String(s.id) === String(selectedSchemaId)) || null;

  const [detectedSchema, setDetectedSchema] = useState<string | null>(null);
  const [showNewSchema, setShowNewSchema] = useState(false);
  const [newSchemaName, setNewSchemaName] = useState("");
  const [newSchemaColumns, setNewSchemaColumns] = useState([{ key: "", data_type: "text", description: "" }]);

  const autoMapMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDataset) throw new Error("No dataset selected");
      return ingestApi.mapDatasetToLogical(
        selectedDataset.id,
        undefined,
        true
      );
    },
    onSuccess: (data: any) => {
      if (data.detected_schema) {
        setDetectedSchema(data.detected_schema);
        toast.success(`Auto-mapped to: ${data.detected_schema}`);
      } else {
        toast.success(data.message || "Auto-mapping applied");
      }
      if (data.target_to_source_map) {
        // Reverse it to source -> target for the UI
        const newMap = {} as ColumnMapping;
        Object.entries(data.target_to_source_map).forEach(([tgt, src]) => {
          newMap[src as string] = tgt;
        });
        setMappingDraft({ columnMappings: newMap });
        
        // Auto-select the schema so target keys appear immediately
        if (data.logical_dataset_id && data.detected_schema) {
          const tempSchema = {
             id: data.logical_dataset_id,
             schema_name: data.detected_schema,
             schema_type: "dynamic" as const,
             columns: Object.keys(data.target_to_source_map).map(k => ({ key: k, data_type: "text" }))
          } as TargetSchemaResponse;
          setMappingDraft({ selectedSchemaId: String(tempSchema.id) });
        }
      }
      qc.invalidateQueries({ queryKey: ["datasets", productId] });
      qc.invalidateQueries({ queryKey: ["schemas", productId] });
    },
    onError: (err: Error) => toast.error(err.message || "Auto-map failed"),
  });

  const confirmMutation = useMutation({
    mutationFn: async (mappings: Record<string, string>) => {
      if (!selectedSchema) {
         throw new Error("Please select a Target Schema from the right panel to save corrections to it.");
      }
      if (!selectedDataset) {
         throw new Error("No dataset selected.");
      }
      
      // 1. Re-map the dataset and materialize the new columns
      await ingestApi.mapDatasetToLogical(
          selectedDataset.id,
          selectedSchema.id as string,
          false,
          mappings
      );
      
      // 2. Record individual corrections for AI
      const promises = Object.entries(mappings).map(([src, tgt]) => {
          if (tgt) {
              return mapApi.confirm({
                product_id: productId,
                schema_name: selectedSchema.schema_name,
                source_column: src,
                correct_target_key: tgt,
              }).catch(e => console.warn("Failed to record correction for", src, ":", e));
          }
      });
      await Promise.all(promises);
      
      return true;
    },
    onSuccess: () => {
        toast.success("Mapping correction saved and data re-processed!");
        qc.invalidateQueries({ queryKey: ["datasets", productId] });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save correction"),
  });

  const deleteSchemaM = useMutation({
    mutationFn: (schema: TargetSchemaResponse) => {
      if (schema.schema_type === "dynamic") {
         return ingestApi.deleteLogicalDataset(schema.id as string);
      }
      return schemasApi.delete(schema.id as number);
    },
    onSuccess: () => {
      toast.success("Schema deleted");
      qc.invalidateQueries({ queryKey: ["schemas", productId] });
      if (selectedSchema) setMappingDraft({ selectedSchemaId: null });
    },
  });

  const createSchemaM = useMutation({
    mutationFn: () =>
      schemasApi.create({
        product_id: productId,
        schema_name: newSchemaName,
        columns: newSchemaColumns
          .filter((c) => c.key)
          .map((c) => ({
            ...c,
            label: c.key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
          })),
      }),
    onSuccess: () => {
      toast.success("Schema created");
      qc.invalidateQueries({ queryKey: ["schemas", productId] });
      setShowNewSchema(false);
      setNewSchemaName("");
      setNewSchemaColumns([{ key: "", data_type: "text", description: "" }]);
    },
    onError: () => toast.error("Failed to create schema"),
  });

  const sourceColumns = selectedDataset?.columns ?? [];
  const targetKeys = selectedSchema?.columns.map((c) => c.key) ?? [];

  return (
    <>
      <Header title="Mapping" subtitle="Map source columns to target schemas with AI intelligence" />
      <div className="page-body">
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr 280px", gap: 20, maxWidth: 1300 }}>

          {/* LEFT — Dataset list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="card-glass">
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "hsl(220 10% 60%)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Datasets
              </h3>
              {loadingDatasets ? (
                <div style={{ textAlign: "center", padding: 20 }}><Loader2 size={16} /></div>
              ) : datasets && datasets.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {datasets.map((ds, i) => (
                    <button
                      key={ds.id || i}
                      onClick={() => { setMappingDraft({ selectedDatasetId: ds.id, columnMappings: {} }); }}
                      style={{
                        textAlign: "left", padding: "10px 12px", borderRadius: 9, cursor: "pointer",
                        border: "1px solid",
                        background: selectedDataset?.id === ds.id ? "rgba(167,139,250,0.1)" : "hsl(220 15% 10%)",
                        borderColor: selectedDataset?.id === ds.id ? "rgba(167,139,250,0.4)" : "hsl(220 15% 18%)",
                        transition: "all 0.12s",
                      }}
                    >
                      <p style={{ fontSize: 13, fontWeight: 600, color: "hsl(220 20% 88%)", marginBottom: 2 }}>
                        {ds.original_filename}
                      </p>
                      <p style={{ fontSize: 11, color: "hsl(220 10% 50%)" }}>
                        {ds.columns?.length ?? 0} cols · {ds.row_count?.toLocaleString() ?? 0} rows
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "hsl(220 10% 45%)", textAlign: "center", padding: "16px 0" }}>
                  No datasets. Upload files first.
                </p>
              )}
            </div>
          </div>

          {/* CENTER — Mapping engine */}
          <div className="card-glass">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600 }}>Column Mapping</h3>
              <div style={{ display: "flex", gap: 8 }}>
                {selectedDataset && (
                  <button
                    className="btn-gradient"
                    onClick={() => autoMapMutation.mutate()}
                    disabled={autoMapMutation.isPending}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px" }}
                  >
                    {autoMapMutation.isPending ? <Loader2 size={13} /> : <Wand2 size={13} />}
                    AI Auto-Map
                  </button>
                )}
              </div>
            </div>

            {!selectedDataset ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "hsl(220 10% 45%)" }}>
                <Wand2 size={40} style={{ margin: "0 auto 14px", display: "block", opacity: 0.3 }} />
                <p style={{ fontSize: 14 }}>Select a dataset from the left panel to start mapping</p>
              </div>
            ) : (
              <>
                {detectedSchema && (
                  <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <CheckCircle2 size={14} color="#a78bfa" />
                    <span style={{ fontSize: 13, color: "#c4b5fd" }}>Auto-detected schema: <strong>{detectedSchema}</strong></span>
                  </div>
                )}
                <div style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 40px 1fr", gap: 8, paddingBottom: 10, borderBottom: "1px solid hsl(220 15% 16%)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "hsl(220 10% 50%)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Source Column</div>
                  <div />
                  <div style={{ fontSize: 11, fontWeight: 700, color: "hsl(220 10% 50%)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Target Key</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {sourceColumns.map((col, i) => (
                    <div key={`${col}-${i}`} className="mapping-row">
                      <div style={{
                        padding: "8px 12px", background: "hsl(220 15% 12%)",
                        border: "1px solid hsl(220 15% 20%)", borderRadius: 8,
                        fontSize: 13, fontWeight: 500, color: "#60a5fa",
                      }}>
                        {col}
                      </div>
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <ArrowRight size={16} color="hsl(220 10% 40%)" />
                      </div>
                      <div style={{ position: "relative" }}>
                        <select
                          value={columnMappings[col] || ""}
                          onChange={(e) =>
                            setMappingDraft({ columnMappings: { ...columnMappings, [col]: e.target.value } })
                          }
                          style={{
                            width: "100%", padding: "8px 12px",
                            background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 20%)",
                            borderRadius: 8, color: columnMappings[col] ? "#a78bfa" : "hsl(220 10% 45%)",
                            fontSize: 13, cursor: "pointer", outline: "none", appearance: "none",
                          }}
                        >
                          <option value="">— skip —</option>
                          {targetKeys.map((k, i) => (
                            <option key={`${k}-${i}`} value={k}>{k}</option>
                          ))}
                        </select>
                        <ChevronDown size={12} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "hsl(220 10% 45%)", pointerEvents: "none" }} />
                      </div>
                    </div>
                  ))}
                  {sourceColumns.length === 0 && (
                    <p style={{ textAlign: "center", color: "hsl(220 10% 45%)", fontSize: 13, padding: "20px 0" }}>
                      No columns found for this dataset.
                    </p>
                  )}
                </div>

                {Object.keys(columnMappings).length > 0 && (
                  <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
                    <button
                      className="btn-gradient"
                      onClick={() => confirmMutation.mutate(columnMappings)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px" }}
                    >
                      <Send size={13} /> Save Corrections
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* RIGHT — Schema panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="card-glass">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: "hsl(220 10% 60%)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Target Schemas
                </h3>
                <button
                  onClick={() => setShowNewSchema(!showNewSchema)}
                  style={{
                    background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)",
                    borderRadius: 6, padding: "3px 8px", cursor: "pointer",
                    color: "#a78bfa", fontSize: 11, fontWeight: 700,
                  }}
                >
                  <Plus size={11} style={{ display: "inline", marginRight: 3 }} />NEW
                </button>
              </div>

              {showNewSchema && (
                <div style={{ marginBottom: 14, padding: 12, background: "hsl(220 15% 10%)", borderRadius: 10, border: "1px solid hsl(220 15% 18%)" }}>
                  <input
                    value={newSchemaName}
                    onChange={(e) => setNewSchemaName(e.target.value)}
                    placeholder="Schema name"
                    style={{
                      width: "100%", background: "hsl(220 15% 14%)",
                      border: "1px solid hsl(220 15% 22%)", borderRadius: 6,
                      padding: "6px 10px", color: "hsl(220 20% 90%)", fontSize: 12, outline: "none", marginBottom: 8,
                    }}
                  />
                  <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 50%)", marginBottom: 6 }}>Columns</div>
                  {newSchemaColumns.map((col, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 6 }}>
                      <input
                        placeholder="Column Key (e.g. user_id)"
                        value={col.key}
                        onChange={(e) => {
                          const upd = [...newSchemaColumns];
                          upd[idx].key = e.target.value.toLowerCase().replace(/\s+/g, '_');
                          setNewSchemaColumns(upd);
                        }}
                        style={{ flex: 2, background: "hsl(220 15% 14%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 6, padding: "5px 8px", color: "hsl(220 20% 90%)", fontSize: 11, outline: "none" }}
                      />
                      <select
                        value={col.data_type}
                        onChange={(e) => {
                          const upd = [...newSchemaColumns];
                          upd[idx].data_type = e.target.value;
                          setNewSchemaColumns(upd);
                        }}
                        style={{ flex: 1, background: "hsl(220 15% 14%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 6, color: "hsl(220 20% 90%)", fontSize: 11, outline: "none" }}
                      >
                        <option value="text">text</option>
                        <option value="integer">integer</option>
                        <option value="float">float</option>
                        <option value="boolean">boolean</option>
                        <option value="date">date</option>
                        <option value="time">time</option>
                        <option value="datetime">datetime</option>
                        <option value="json">json</option>
                        <option value="email">email</option>
                        <option value="phone">phone</option>
                      </select>
                    </div>
                  ))}
                  <button
                    onClick={() => setNewSchemaColumns((p) => [...p, { key: "", data_type: "text", description: "" }])}
                    style={{ fontSize: 11, color: "#a78bfa", background: "none", border: "none", cursor: "pointer", padding: "2px 0", marginBottom: 8 }}
                  >
                    + Add column
                  </button>
                  <button
                    className="btn-gradient"
                    onClick={() => createSchemaM.mutate()}
                    disabled={!newSchemaName || createSchemaM.isPending}
                    style={{ width: "100%", padding: "6px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 12 }}
                  >
                    {createSchemaM.isPending ? <Loader2 size={12} /> : <Plus size={12} />}
                    Create Schema
                  </button>
                </div>
              )}

              {loadingSchemas ? (
                <div style={{ textAlign: "center", padding: 20 }}><Loader2 size={16} /></div>
              ) : schemas && schemas.length > 0 ? (
                schemas.map((schema, i) => (
                  <div
                    key={schema.id || i}
                    style={{
                      marginBottom: 8, padding: "10px 12px", borderRadius: 9, cursor: "pointer",
                      border: "1px solid",
                      background: selectedSchema?.id === schema.id ? "rgba(167,139,250,0.08)" : "hsl(220 15% 10%)",
                      borderColor: selectedSchema?.id === schema.id ? "rgba(167,139,250,0.35)" : "hsl(220 15% 18%)",
                      transition: "all 0.12s",
                    }}
                    onClick={() => setMappingDraft({ selectedSchemaId: selectedSchema?.id === schema.id ? null : String(schema.id) })}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(220 20% 86%)" }}>{schema.schema_name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSchemaM.mutate(schema); }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", display: "flex" }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <p style={{ fontSize: 11, color: "hsl(220 10% 50%)", marginTop: 3 }}>
                      {schema.columns.length} columns
                    </p>
                    {selectedSchema?.id === schema.id && (
                      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {schema.columns.map((c, i) => (
                          <span key={`${c.key}-${i}`} style={{
                            fontSize: 10, padding: "2px 7px", borderRadius: 999,
                            background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)",
                            color: "#93c5fd",
                          }}>
                            {c.key}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p style={{ fontSize: 13, color: "hsl(220 10% 45%)", textAlign: "center", padding: "16px 0" }}>
                  No schemas. Create one above.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
