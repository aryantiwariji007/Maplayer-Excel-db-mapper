import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppStore } from "@/types";

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      productId: "default",
      setProductId: (id: string) => set({ productId: id }),

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
