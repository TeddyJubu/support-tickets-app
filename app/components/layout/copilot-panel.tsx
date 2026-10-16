"use client";

import { CopilotChat } from "@yourgpt/copilot-sdk/ui";

// Tool cards (including loading skeletons and approval steps) are rendered by
// each tool's `render` in ticketing-tools.tsx.
export function CopilotPanel() {
  return (
    <div className="w-[420px] border-l border-border flex flex-col bg-muted shrink-0">
      <CopilotChat
        placeholder="Ask about this ticket, the customer, products or past tickets..."
        className="h-full"
        persistence={true}
        showThreadPicker={true}
        header={{
          name: "Support Copilot",
        }}
        suggestions={[
          "Summarize this ticket",
          "Who is this customer and how valuable are they?",
          "Find similar tickets",
          "Draft a response to the customer",
        ]}
      />
    </div>
  );
}
