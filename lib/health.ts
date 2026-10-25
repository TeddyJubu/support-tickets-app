// Readiness checks behind /api/ready and `helpdesk status`. Results are booleans and short
// details only: the endpoint is public, so it never includes data.

import { schemaVersion } from "./db";
import { getDb } from "./sim-db";
import { SIM_MIGRATIONS } from "./sim-migrations";
import { kbHealth } from "./kb/health";
import { workerHealth } from "./worker/state";

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
    worker: check(() => {
      const w = workerHealth();
      if (!w.heartbeat) return { ok: false, detail: "never started" };
      if (!w.alive) return { ok: false, detail: `no heartbeat for ${w.ageSeconds} s` };
      const backlog = getDb()
        // Jobs due now only: a draft retrying later (AI outage) isn't a stuck worker
        .prepare(`SELECT min(run_after) AS t FROM jobs WHERE state IN ('pending', 'retry_wait') AND run_after <= datetime('now')`)
        .get() as { t: string | null };
      const waitMinutes = backlog.t ? (Date.now() - Date.parse(`${backlog.t.replace(" ", "T")}Z`)) / 60_000 : 0;
      return waitMinutes > 10 ? { ok: false, detail: `oldest draft job waiting ${Math.round(waitMinutes)} min` } : { ok: true };
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
