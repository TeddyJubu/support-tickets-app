"use client";

import { useCallback, useState } from "react";
import { CopilotProvider } from "@yourgpt/copilot-sdk/react";
import { DashboardProvider } from "./components/context/dashboard-context";
import { TicketingTools } from "./components/ticketing-tools";
import {
  DemoSidebar,
  TicketHeader,
  ConversationArea,
  CopilotPanel,
  Toaster,
  ShortcutsDialog,
  useHotkeys,
} from "./components/layout";

const SYSTEM_PROMPT = `You are an AI assistant helping Cute Things' customer support agents (a small online baby and children's store).

**Data:**
The open ticket, its customer and their recent tickets are in your context. Tickets arrive by email to support@teddyonfriday.com and include the message text. Store data (products, orders, customers) is not connected yet, so lookups may return nothing. Never invent order details, products or policies; say what you don't know.

**Response Style:**
Be concise by default. Tools display UI cards with full details, so don't repeat that data in your response. Keep it brief and actionable - elaborate only when the agent asks for more details.`;

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

export default function SupportTicketsPage() {
  return (
    <DashboardProvider>
      <CopilotProvider
        runtimeUrl="/api/chat"
        systemPrompt={SYSTEM_PROMPT}
        streaming={true}
        maxIterations={4}
      >
        <TicketingTools />
        <Workspace />
      </CopilotProvider>
    </DashboardProvider>
  );
}
