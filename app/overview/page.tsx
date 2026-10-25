import type { Metadata } from "next";
import { storeSettings } from "@/lib/settings";
import { ConsoleShell } from "../components/console-shell";
import { OverviewConsole } from "../components/overview-console";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <ConsoleShell title="Overview" storeName={storeSettings().name}>
      <OverviewConsole />
    </ConsoleShell>
  );
}
