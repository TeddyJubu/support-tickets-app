"use client";

import { useCallback, useState } from "react";
import { CopilotProvider } from "@yourgpt/copilot-sdk/react";
import { DashboardProvider } from "./components/context/dashboard-context";
import { SessionProvider } from "./components/context/session-context";
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

const SYSTEM_PROMPT = `You are an AI assistant helping Buttons Bebe's customer support agents (a children's clothing store).

**Data:**
The open ticket, its Shopify customer and their recent tickets are in your context. Tickets come from a Gorgias export: you have subjects, tags, intents, timing and message counts, but not the message text. Never invent message content, order details or policies; say what you don't know. Use the search tools for products, customers and past tickets.

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
    <SessionProvider>
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
    </SessionProvider>
  );
}
