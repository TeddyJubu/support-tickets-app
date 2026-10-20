"use client";

import { ConsoleShell } from "../components/console-shell";
import { OverviewConsole } from "../components/overview-console";

export default function OverviewPage() {
  return (
    <ConsoleShell title="Overview">
      <OverviewConsole />
    </ConsoleShell>
  );
}
