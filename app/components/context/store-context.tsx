"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SignedInAgent } from "@/lib/auth";
import type { StoreSettings } from "@/lib/settings";

// This install's store settings (lib/settings.ts) and the signed-in agent, read on the
// server and passed down by app/page.tsx
const StoreContext = createContext<{ store: StoreSettings; agent: SignedInAgent | null } | null>(null);

export function StoreProvider({
  store,
  agent,
  children,
}: {
  store: StoreSettings;
  agent: SignedInAgent | null;
  children: ReactNode;
}) {
  return <StoreContext.Provider value={{ store, agent }}>{children}</StoreContext.Provider>;
}

function useStoreContext() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used within StoreProvider");
  return value;
}

export const useStore = () => useStoreContext().store;

/** null for the operator's API key (no browser session) */
export const useAgent = () => useStoreContext().agent;
