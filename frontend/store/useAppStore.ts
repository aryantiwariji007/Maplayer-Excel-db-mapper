import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppStore } from "@/types";

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      productId: "default",
      productIds: ["default", "crm-prod", "ecommerce-v2", "analytics-core"],
      setProductId: (id: string) =>
        set((state) => ({
          productId: id,
          productIds: Array.from(new Set([id, ...state.productIds])),
        })),

      // Compose Draft
      composeDraft: {
        viewName: "",
        description: "",
        sources: [],
      },
      setComposeDraft: (draft) =>
        set((state) => ({ composeDraft: { ...state.composeDraft, ...draft } })),
      resetComposeDraft: () =>
        set({ composeDraft: { viewName: "", description: "", sources: [] } }),

      // Mapping Draft
      mappingDraft: {
        selectedDatasetId: null,
        selectedSchemaId: null,
        columnMappings: {},
      },
      setMappingDraft: (draft) =>
        set((state) => ({ mappingDraft: { ...state.mappingDraft, ...draft } })),
      resetMappingDraft: () =>
        set({
          mappingDraft: {
            selectedDatasetId: null,
            selectedSchemaId: null,
            columnMappings: {},
          },
        }),
    }),
    { name: "maplayer-store" }
  )
);
