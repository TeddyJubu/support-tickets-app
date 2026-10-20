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
The open ticket, its customer and their recent tickets are in your context. Inbox tickets include the full conversation; archived tickets come from a Gorgias export with subjects, tags, intents, timing and message counts but no message text. Never invent message content, order details or policies; say what you don't know.

**Store policy:** Before answering anything about policy, shipping, returns, refunds, sizing or products, call search_knowledge_base and base the answer on what it returns. Live notices override articles. Results marked sensitive (refunds, damage, cancellations, angry customers…) need a person to decide: draft, but say so. Use the other search tools for products, customers and past tickets.

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
