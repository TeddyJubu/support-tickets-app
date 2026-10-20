// Readiness checks behind /api/ready and `helpdesk status`. Results are booleans and short
// details only: the endpoint is public, so it never includes data.

import { schemaVersion } from "./db";
import { getDb } from "./sim-db";
import { SIM_MIGRATIONS } from "./sim-migrations";

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
  };
  return { ready: Object.values(checks).every((c) => c.ok), checks };
}
