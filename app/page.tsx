"use client";

import { CopilotProvider } from "@yourgpt/copilot-sdk/react";
import { DashboardProvider } from "./components/context/dashboard-context";
import { TicketingTools } from "./components/ticketing-tools";
import {
  DemoSidebar,
  TicketHeader,
  ConversationArea,
  CopilotPanel,
} from "./components/layout";

const SYSTEM_PROMPT = `You are an AI assistant helping Buttons Bebe's customer support agents (a children's clothing store).

**Data:**
The open ticket, its Shopify customer and their recent tickets are in your context. Tickets come from a Gorgias export: you have subjects, tags, intents, timing and message counts, but not the message text. Never invent message content, order details or policies; say what you don't know. Use the search tools for products, customers and past tickets.

**Response Style:**
Be concise by default. Tools display UI cards with full details, so don't repeat that data in your response. Keep it brief and actionable - elaborate only when the agent asks for more details.`;

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
        <div className="h-screen flex bg-background overflow-hidden text-foreground">
          <DemoSidebar />
          <main className="flex-1 flex flex-col overflow-hidden min-w-0">
            <TicketHeader />
            <div className="flex-1 flex overflow-hidden">
              <ConversationArea />
              <CopilotPanel />
            </div>
          </main>
        </div>
      </CopilotProvider>
    </DashboardProvider>
  );
}
