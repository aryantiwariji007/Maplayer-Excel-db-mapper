import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppStore } from "@/types";

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      productId: "default",
      setProductId: (id: string) => set({ productId: id }),
    }),
    { name: "maplayer-store" }
  )
);
