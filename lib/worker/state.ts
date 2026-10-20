// Worker heartbeat and scheduled-task bookkeeping (data/sim.db worker_state)

import { getDb } from "../sim-db";

export const HEARTBEAT_STALE_SECONDS = 120;

export function setState(key: string, value: unknown) {
  getDb()
    .prepare(
      `INSERT INTO worker_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value));
}

export function getState<T>(key: string): { value: T; updatedAt: string } | null {
  const r = getDb().prepare(`SELECT value, updated_at FROM worker_state WHERE key = ?`).get(key) as
    | { value: string; updated_at: string }
    | undefined;
  return r ? { value: JSON.parse(r.value) as T, updatedAt: `${r.updated_at.replace(" ", "T")}Z` } : null;
}

export interface Heartbeat {
  pid: number;
  startedAt: string;
  current: { jobId: number; ticketId: string } | null;
  lastJobAt: string | null;
}

/** Worker liveness: fresh within two minutes */
export function workerHealth() {
  const hb = getState<Heartbeat>("heartbeat");
  if (!hb) return { alive: false, ageSeconds: null as number | null, heartbeat: null as Heartbeat | null };
  const ageSeconds = Math.round((Date.now() - Date.parse(hb.updatedAt)) / 1000);
  return { alive: ageSeconds < HEARTBEAT_STALE_SECONDS, ageSeconds, heartbeat: hb.value };
}
