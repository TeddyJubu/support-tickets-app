import type { Metadata } from "next";
import { storeSettings } from "@/lib/settings";
import { ConsoleShell } from "../components/console-shell";
import { KbConsole } from "../components/kb/kb-console";

export const metadata: Metadata = { title: "Knowledge base" };

export default function KnowledgeBasePage() {
  return (
    <ConsoleShell title="Knowledge base" storeName={storeSettings().name}>
      <KbConsole />
    </ConsoleShell>
  );
}
