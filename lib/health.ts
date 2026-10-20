// Readiness checks behind /api/ready and `helpdesk status`. Results are booleans and short
// details only: the endpoint is public, so it never includes data.

import { schemaVersion } from "./db";
import { getDb } from "./sim-db";
import { SIM_MIGRATIONS } from "./sim-migrations";
import { kbHealth } from "./kb/health";

export interface Check {
  ok: boolean;
  detail?: string;
}

function check(fn: () => Check): Check {
  try {
    return fn();
  } catch {
    return { ok: false, detail: "check failed" };
  }
}

export function readiness() {
  const checks: Record<string, Check> = {
    database: check(() => {
      const latest = Math.max(...SIM_MIGRATIONS.map((m) => m.version));
      const current = schemaVersion(getDb());
      return current === latest ? { ok: true } : { ok: false, detail: `schema ${current}, expected ${latest}` };
    }),
    // The last good index keeps serving after a failed rebuild, so only "no index at all" is fatal
    knowledgeBase: check(() => {
      const kb = kbHealth();
      if (!kb.indexBuiltAt) return { ok: false, detail: "no index" };
      return kb.index.state === "failed" ? { ok: true, detail: "last rebuild failed; serving the previous index" } : { ok: true };
    }),
  };
  // ready: this process can serve (database). healthy: everything around it works too.
  return { ready: checks.database.ok, healthy: Object.values(checks).every((c) => c.ok), checks };
}
