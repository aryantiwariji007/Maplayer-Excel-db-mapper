"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ingestApi, schemasApi } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";
import Header from "@/components/layout/Header";
import type { TargetSchemaResponse } from "@/types";
import {
  Loader2, Plus, Trash2, ChevronDown, ChevronRight,
  BookOpen, Pencil, X, Check
} from "lucide-react";

const PURPLE = "#a78bfa";
const BLUE = "#60a5fa";
const GREEN = "#4ade80";

const DATA_TYPES = ["text", "integer", "float", "boolean", "date", "time", "datetime", "json", "email", "phone"];

type ColumnDraft = { key: string; data_type: string; description: string };

function toLabel(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export default function ProfilesPage() {
  const { productId } = useAppStore();
  const qc = useQueryClient();

  const { data: schemas, isLoading: loadingSchemas } = useQuery({
    queryKey: ["all-schemas", productId],
    queryFn: () => ingestApi.listAllSchemas(productId),
    enabled: !!productId,
  });

  const { data: logicalDatasets } = useQuery({
    queryKey: ["logical-datasets", productId],
    queryFn: () => ingestApi.listLogicalDatasets(productId),
    enabled: !!productId,
  });

  const deleteDynamicM = useMutation({
    mutationFn: (id: string) => ingestApi.deleteLogicalDataset(id),
    onSuccess: () => {
      toast.success("Dynamic dataset deleted");
      qc.invalidateQueries({ queryKey: ["logical-datasets", productId] });
      qc.invalidateQueries({ queryKey: ["all-schemas", productId] });
    },
    onError: () => toast.error("Failed to delete dynamic dataset"),
  });

  // Expand/collapse state for schema cards
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Modal state (null = closed, "create" = new, TargetSchemaResponse = editing)
  const [modal, setModal] = useState<"create" | TargetSchemaResponse | null>(null);
  const [modalName, setModalName] = useState("");
  const [modalColumns, setModalColumns] = useState<ColumnDraft[]>([{ key: "", data_type: "text", description: "" }]);

  const openCreate = () => {
    setModalName("");
    setModalColumns([{ key: "", data_type: "text", description: "" }]);
    setModal("create");
  };

  const openEdit = (schema: TargetSchemaResponse) => {
    setModalName(schema.schema_name);
    setModalColumns(
      schema.columns.length > 0
        ? schema.columns.map((c) => ({ key: c.key, data_type: c.data_type, description: c.description ?? "" }))
        : [{ key: "", data_type: "text", description: "" }]
    );
    setModal(schema);
  };

  const closeModal = () => setModal(null);

  const addColumn = () => setModalColumns((p) => [...p, { key: "", data_type: "text", description: "" }]);
  const removeColumn = (idx: number) => setModalColumns((p) => p.filter((_, i) => i !== idx));
  const updateColumn = (idx: number, field: keyof ColumnDraft, value: string) => {
    setModalColumns((p) => {
      const next = [...p];
      if (field === "key") {
        next[idx] = { ...next[idx], key: value.toLowerCase().replace(/\s+/g, "_") };
      } else {
        next[idx] = { ...next[idx], [field]: value };
      }
      return next;
    });
  };

  const createSchemaM = useMutation({
    mutationFn: () =>
      schemasApi.create({
        product_id: productId,
        schema_name: modalName.trim(),
        columns: modalColumns
          .filter((c) => c.key)
          .map((c) => ({ key: c.key, label: toLabel(c.key), data_type: c.data_type, description: c.description || undefined })),
      }),
    onSuccess: () => {
      toast.success("Schema created");
      qc.invalidateQueries({ queryKey: ["all-schemas", productId] });
      qc.invalidateQueries({ queryKey: ["schemas", productId] });
      closeModal();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create schema"),
  });

  const updateSchemaM = useMutation({
    mutationFn: ({ id, name, columns }: { id: string; name: string; columns: ColumnDraft[] }) =>
      schemasApi.update(String(id), {
        schema_name: name.trim(),
        columns: columns
          .filter((c) => c.key)
          .map((c) => ({ key: c.key, label: toLabel(c.key), data_type: c.data_type, description: c.description || undefined })),
      }),
    onSuccess: () => {
      toast.success("Schema updated");
      qc.invalidateQueries({ queryKey: ["all-schemas", productId] });
      qc.invalidateQueries({ queryKey: ["schemas", productId] });
      closeModal();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update schema"),
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
      qc.invalidateQueries({ queryKey: ["all-schemas", productId] });
      qc.invalidateQueries({ queryKey: ["schemas", productId] });
      qc.invalidateQueries({ queryKey: ["logical-datasets", productId] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to delete schema"),
  });

  const handleSubmitModal = () => {
    if (!modalName.trim()) return;
    const validCols = modalColumns.filter((c) => c.key);
    if (validCols.length === 0) {
      toast.error("Add at least one column with a key.");
      return;
    }
    if (modal === "create") {
      createSchemaM.mutate();
    } else if (modal !== null) {
      updateSchemaM.mutate({ id: String(modal.id), name: modalName, columns: modalColumns });
    }
  };

  const isMutating = createSchemaM.isPending || updateSchemaM.isPending;

  const staticSchemas = schemas?.filter((s) => s.schema_type === "static" || !s.schema_type) ?? [];

  return (
    <>
      <Header title="Schema Profiles" subtitle="Create and manage column schemas for AI-powered data mapping" />
      <div className="page-body">
        <div style={{ maxWidth: 860 }}>

          {/* Section header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <BookOpen size={18} color={PURPLE} />
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700 }}>Schema Profiles</h2>
                <p style={{ fontSize: 12, color: "hsl(220 10% 50%)", marginTop: 2 }}>
                  {(schemas?.length ?? 0)} schema{(schemas?.length ?? 0) !== 1 ? "s" : ""} defined · AI uses these to auto-map uploaded files
                </p>
              </div>
            </div>
            <button
              className="btn-gradient"
              onClick={openCreate}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 18px" }}
            >
              <Plus size={14} /> New Profile
            </button>
          </div>

          {loadingSchemas ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "hsl(220 10% 50%)" }}>
              <Loader2 size={22} style={{ margin: "0 auto 10px", display: "block" }} /> Loading schemas…
            </div>
          ) : (schemas?.length ?? 0) === 0 ? (
            <div className="card-glass" style={{ textAlign: "center", padding: "60px 20px", color: "hsl(220 10% 45%)" }}>
              <BookOpen size={40} style={{ margin: "0 auto 14px", display: "block", opacity: 0.25 }} />
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No schemas yet</p>
              <p style={{ fontSize: 13, color: "hsl(220 10% 40%)", marginBottom: 20 }}>
                Create a schema profile to define the target columns for your data.
              </p>
              <button className="btn-gradient" onClick={openCreate} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 20px" }}>
                <Plus size={14} /> Create First Profile
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

              {/* Static schemas */}
              {staticSchemas.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: BLUE }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Static Schemas ({staticSchemas.length})
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {staticSchemas.map((schema) => (
                      <SchemaCard
                        key={schema.id}
                        schema={schema}
                        expanded={expandedIds.has(String(schema.id))}
                        onToggle={() => toggleExpand(String(schema.id))}
                        onEdit={() => openEdit(schema)}
                        onDelete={() => {
                          if (confirm(`Delete schema "${schema.schema_name}"? This cannot be undone.`)) {
                            deleteSchemaM.mutate(schema);
                          }
                        }}
                        accentColor={BLUE}
                        canEdit
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Logical Datasets (auto-created from static schemas) */}
              {logicalDatasets && logicalDatasets.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Dynamic Datasets ({logicalDatasets.length})
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {logicalDatasets.map((ld) => (
                      <div key={ld.id} style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid hsl(220 15% 20%)", background: "hsl(220 15% 10%)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700 }}>{ld.dataset_name}</span>
                            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, background: `${GREEN}20`, border: `1px solid ${GREEN}44`, color: GREEN, fontWeight: 600 }}>Dynamic</span>
                          </div>
                          {ld.description && (
                            <p style={{ fontSize: 11, color: "hsl(220 10% 45%)", marginTop: 3 }}>{ld.description}</p>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${ld.dataset_name}"? This also removes its analytics table.`)) {
                              deleteDynamicM.mutate(ld.id);
                            }
                          }}
                          disabled={deleteDynamicM.isPending}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", padding: 6, opacity: 0.45, borderRadius: 6, display: "flex", alignItems: "center", transition: "opacity 0.15s" }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.45")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}


            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Modal */}
      {modal !== null && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={closeModal}
        >
          <div
            style={{ background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 24%)", borderRadius: 16, padding: 28, width: 560, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.7)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>
                  {modal === "create" ? "New Schema Profile" : `Edit: ${(modal as TargetSchemaResponse).schema_name}`}
                </h3>
                <p style={{ fontSize: 12, color: "hsl(220 10% 50%)", marginTop: 3 }}>
                  {modal === "create" ? "Define the target columns for this schema." : "Update the schema name and column definitions."}
                </p>
              </div>
              <button onClick={closeModal} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(220 10% 50%)", padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {/* Schema name */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>
                Schema Name
              </label>
              <input
                autoFocus
                value={modalName}
                onChange={(e) => setModalName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") closeModal(); }}
                placeholder="e.g. vendor_quotes"
                style={{ width: "100%", background: "hsl(220 15% 9%)", border: "1px solid hsl(220 15% 23%)", borderRadius: 8, padding: "9px 12px", color: "hsl(220 20% 92%)", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>

            {/* Columns */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 10% 55%)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Columns ({modalColumns.filter((c) => c.key).length} defined)
                </label>
                <button onClick={addColumn} style={{ fontSize: 11, color: PURPLE, background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                  <Plus size={11} /> Add column
                </button>
              </div>

              {/* Column header */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr 28px", gap: 6, marginBottom: 6, padding: "0 4px" }}>
                {["Key (snake_case)", "Type", "Description", ""].map((h, i) => (
                  <span key={i} style={{ fontSize: 10, fontWeight: 700, color: "hsl(220 10% 45%)", textTransform: "uppercase", letterSpacing: "0.4px" }}>{h}</span>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                {modalColumns.map((col, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr 28px", gap: 6, alignItems: "center" }}>
                    <input
                      value={col.key}
                      onChange={(e) => updateColumn(idx, "key", e.target.value)}
                      placeholder="column_key"
                      style={{ background: "hsl(220 15% 9%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 7, padding: "6px 10px", color: "hsl(220 20% 90%)", fontSize: 12, outline: "none", fontFamily: "monospace" }}
                    />
                    <select
                      value={col.data_type}
                      onChange={(e) => updateColumn(idx, "data_type", e.target.value)}
                      style={{ background: "hsl(220 15% 9%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 7, padding: "6px 8px", color: "hsl(220 20% 90%)", fontSize: 12, outline: "none" }}
                    >
                      {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input
                      value={col.description}
                      onChange={(e) => updateColumn(idx, "description", e.target.value)}
                      placeholder="Optional description"
                      style={{ background: "hsl(220 15% 9%)", border: "1px solid hsl(220 15% 22%)", borderRadius: 7, padding: "6px 10px", color: "hsl(220 20% 90%)", fontSize: 12, outline: "none" }}
                    />
                    <button
                      onClick={() => removeColumn(idx)}
                      disabled={modalColumns.length === 1}
                      style={{ background: "none", border: "none", cursor: modalColumns.length === 1 ? "not-allowed" : "pointer", color: "#f87171", display: "flex", alignItems: "center", justifyContent: "center", opacity: modalColumns.length === 1 ? 0.3 : 0.6, transition: "opacity 0.1s" }}
                      onMouseEnter={(e) => { if (modalColumns.length > 1) e.currentTarget.style.opacity = "1"; }}
                      onMouseLeave={(e) => { if (modalColumns.length > 1) e.currentTarget.style.opacity = "0.6"; }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={closeModal}
                style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, background: "transparent", border: "1px solid hsl(220 15% 22%)", cursor: "pointer", color: "hsl(220 10% 60%)" }}
              >
                Cancel
              </button>
              <button
                className="btn-gradient"
                onClick={handleSubmitModal}
                disabled={!modalName.trim() || isMutating}
                style={{ padding: "8px 22px", display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}
              >
                {isMutating ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                {modal === "create" ? "Create Profile" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ──────────────────── Schema Card ──────────────────── */
function SchemaCard({
  schema,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  accentColor,
  canEdit,
}: {
  schema: TargetSchemaResponse;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  accentColor: string;
  canEdit: boolean;
}) {
  return (
    <div className="card-glass" style={{ padding: 0, overflow: "hidden" }}>
      {/* Card header */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 12, padding: "14px 18px",
          cursor: "pointer", transition: "background 0.12s",
        }}
        onClick={onToggle}
      >
        <button
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "hsl(220 10% 50%)", display: "flex", alignItems: "center", flexShrink: 0 }}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "hsl(220 20% 90%)" }}>{schema.schema_name}</span>
            <span style={{
              fontSize: 10, padding: "2px 7px", borderRadius: 999, fontWeight: 700,
              background: `${accentColor}20`, border: `1px solid ${accentColor}40`, color: accentColor,
            }}>
              {schema.schema_type === "dynamic" ? "Dynamic" : "Static"}
            </span>
          </div>
          <p style={{ fontSize: 12, color: "hsl(220 10% 50%)", marginTop: 3 }}>
            {schema.columns.length} column{schema.columns.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <button
              onClick={onEdit}
              title="Edit schema"
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 7,
                background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)",
                cursor: "pointer", color: "#a78bfa", fontSize: 12, fontWeight: 600,
              }}
            >
              <Pencil size={12} /> Edit
            </button>
          )}
          <button
            onClick={onDelete}
            title="Delete schema"
            style={{ display: "flex", alignItems: "center", padding: "5px 8px", borderRadius: 7, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", cursor: "pointer", color: "#f87171" }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Expanded column list */}
      {expanded && schema.columns.length > 0 && (
        <div style={{ borderTop: "1px solid hsl(220 15% 16%)", padding: "12px 18px 16px" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 90px 1fr",
            gap: "6px 12px",
            marginBottom: 8,
            padding: "0 4px",
          }}>
            {["Key", "Type", "Description"].map((h) => (
              <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "hsl(220 10% 40%)", textTransform: "uppercase", letterSpacing: "0.4px" }}>{h}</span>
            ))}
          </div>
          {schema.columns.map((col, i) => (
            <div key={`${col.key}-${i}`} style={{ display: "grid", gridTemplateColumns: "1fr 90px 1fr", gap: "4px 12px", padding: "5px 4px", borderRadius: 6, background: i % 2 === 0 ? "transparent" : "hsl(220 15% 9%)" }}>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: accentColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.key}</span>
              <span style={{ fontSize: 11, color: "hsl(220 10% 55%)" }}>{col.data_type}</span>
              <span style={{ fontSize: 12, color: "hsl(220 10% 55%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.description || "—"}</span>
            </div>
          ))}
        </div>
      )}

      {expanded && schema.columns.length === 0 && (
        <div style={{ borderTop: "1px solid hsl(220 15% 16%)", padding: "14px 18px", color: "hsl(220 10% 45%)", fontSize: 13 }}>
          No columns defined.
        </div>
      )}
    </div>
  );
}
