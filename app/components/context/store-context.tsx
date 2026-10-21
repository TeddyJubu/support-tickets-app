"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { StoreSettings } from "@/lib/settings";

// This install's store settings (lib/settings.ts), read on the server and passed down by app/page.tsx
const StoreContext = createContext<StoreSettings | null>(null);

export function StoreProvider({ store, children }: { store: StoreSettings; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used within StoreProvider");
  return store;
}
