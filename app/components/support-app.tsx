"use client";

import { useCallback, useState } from "react";
import { CopilotProvider } from "@yourgpt/copilot-sdk/react";
import type { StoreSettings } from "@/lib/settings";
import { DashboardProvider } from "./context/dashboard-context";
import { StoreProvider } from "./context/store-context";
import { TicketingTools } from "./ticketing-tools";
import {
  DemoSidebar,
  TicketHeader,
  ConversationArea,
  CopilotPanel,
  Toaster,
  ShortcutsDialog,
  useHotkeys,
} from "./layout";

function Workspace() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const showShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const hideShortcuts = useCallback(() => setShortcutsOpen(false), []);
  useHotkeys(showShortcuts, !shortcutsOpen);

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <DemoSidebar onShowShortcuts={showShortcuts} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TicketHeader />
        <div className="relative flex flex-1 overflow-hidden">
          <ConversationArea />
          <CopilotPanel />
        </div>
      </main>
      <Toaster />
      <ShortcutsDialog open={shortcutsOpen} onClose={hideShortcuts} />
    </div>
  );
}

// The copilot's instructions come from the server (app/api/chat/route.ts); the browser only adds ticket context
export function SupportApp({ store }: { store: StoreSettings }) {
  return (
    <StoreProvider store={store}>
      <DashboardProvider>
        <CopilotProvider runtimeUrl="/api/chat" streaming={true} maxIterations={4}>
          <TicketingTools />
          <Workspace />
        </CopilotProvider>
      </DashboardProvider>
    </StoreProvider>
  );
}
