import type { Metadata } from "next";
import { storeSettings } from "@/lib/settings";
import { ConsoleShell } from "../components/console-shell";
import { SettingsConsole } from "../components/settings-console";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <ConsoleShell title="Settings" storeName={storeSettings().name}>
      <SettingsConsole />
    </ConsoleShell>
  );
}
