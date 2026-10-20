"use client";

import { ConsoleShell } from "../components/console-shell";
import { AlertsConsole } from "../components/alerts-console";

export default function AlertsPage() {
  return (
    <ConsoleShell title="Alerts">
      <AlertsConsole />
    </ConsoleShell>
  );
}
