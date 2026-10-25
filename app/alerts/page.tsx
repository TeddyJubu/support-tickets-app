import type { Metadata } from "next";
import { storeSettings } from "@/lib/settings";
import { ConsoleShell } from "../components/console-shell";
import { AlertsConsole } from "../components/alerts-console";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <ConsoleShell title="Alerts" storeName={storeSettings().name}>
      <AlertsConsole />
    </ConsoleShell>
  );
}
