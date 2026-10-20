"use client";

import { ConsoleShell } from "../components/console-shell";
import { KbConsole } from "../components/kb/kb-console";

export default function KnowledgeBasePage() {
  return (
    <ConsoleShell title="Knowledge base">
      <KbConsole />
    </ConsoleShell>
  );
}
