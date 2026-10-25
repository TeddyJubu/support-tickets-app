"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { CopilotProvider } from "@yourgpt/copilot-sdk/react";
import type { StoreSettings } from "@/lib/settings";
import { DashboardProvider, useDashboard } from "./context/dashboard-context";
import { SessionProvider } from "./context/session-context";
import { StoreProvider, useStore } from "./context/store-context";
import { AppHeader } from "./console-shell";
import { TicketingTools } from "./ticketing-tools";
import { cn } from "@/lib/utils";
import {
  DemoSidebar,
  ConversationArea,
  CopilotPanel,
  Toaster,
  ShortcutsDialog,
  useHotkeys,
} from "./layout";

function Workspace() {
  const { ticketSource, setTicketSource, selectTicket, selectedTicketId, sidePanel } = useDashboard();
  const store = useStore();
  const [conversationOpened, setConversationOpened] = useState<boolean | null>(null);
  const showConversation = conversationOpened ?? !!selectedTicketId;
  const backButton = useRef<HTMLButtonElement>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const showShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const hideShortcuts = useCallback(() => setShortcutsOpen(false), []);
  useHotkeys(showShortcuts, !shortcutsOpen && !sidePanel);

  useEffect(() => {
    if (showConversation && window.matchMedia("(max-width: 767px)").matches) backButton.current?.focus();
  }, [showConversation]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <AppHeader title={ticketSource === "history" ? "Archive" : "Inbox"} storeName={store.name} onOpenTicket={(id) => { if (ticketSource !== "sim") setTicketSource("sim"); selectTicket(id); setConversationOpened(true); }} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className={cn("h-full w-full shrink-0 md:w-auto", showConversation && "hidden md:block")}>
        <DemoSidebar onShowShortcuts={showShortcuts} onOpenConversation={() => setConversationOpened(true)} />
      </div>
      <main className={cn("min-w-0 flex-1 flex-col overflow-hidden", showConversation ? "flex" : "hidden md:flex")}>
        <button ref={backButton} type="button" onClick={() => {
          setConversationOpened(false);
          requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-ticket-id="${CSS.escape(selectedTicketId ?? "")}"] > button`)?.focus());
        }} className="inline-flex items-center gap-2 border-b border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent md:hidden">
          <ArrowLeft className="size-4" /> Back to tickets
        </button>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <ConversationArea />
          <CopilotPanel />
        </div>
      </main>
      </div>
      <Toaster />
      <ShortcutsDialog open={shortcutsOpen} onClose={hideShortcuts} />
    </div>
  );
}

// The copilot's instructions come from the server (app/api/chat/route.ts); the browser only adds ticket context
export function SupportApp({ store }: { store: StoreSettings }) {
  return (
    <StoreProvider store={store}>
      <SessionProvider>
        <DashboardProvider>
          <CopilotProvider runtimeUrl="/api/chat" streaming={true} maxIterations={4}>
            <TicketingTools />
            <Workspace />
          </CopilotProvider>
        </DashboardProvider>
      </SessionProvider>
    </StoreProvider>
  );
}
