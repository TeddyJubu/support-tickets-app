"use client";

import { ConsoleShell } from "../components/console-shell";
import { SettingsConsole } from "../components/settings-console";

export default function SettingsPage() {
  return (
    <ConsoleShell title="Settings">
      <SettingsConsole />
    </ConsoleShell>
  );
}
