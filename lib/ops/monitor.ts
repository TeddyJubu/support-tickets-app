// Read-only ops monitor, run by the worker every minute: services, readiness, the draft
// queue, disk space, backup age and off-site copy, KB freshness, failed alerts. Writes data/ops-status.json
// (and the database) for the Overview page and `helpdesk status`. It reports; it never
// repairs or restarts anything.

import { execFileSync } from "node:child_process";
import { renameSync, statfsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db";
import { readiness } from "../health";
import { getDb } from "../sim-db";
import { queueStats } from "../drafting/queue";
import { kbHealth } from "../kb/health";
import { listBackups, offsiteStatus } from "./backup";
import { getState, setState, workerHealth } from "../worker/state";

export const OPS_STALE_SECONDS = 180;
const BACKUP_MAX_AGE_HOURS = 8;
const DISK_MIN_FREE_PCT = 10;

function service(name: string) {
  try {
    return execFileSync("systemctl", ["is-active", name], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (err) {
    const out = (err as { stdout?: string }).stdout?.trim();
    return out || "unknown";
  }
}

export interface OpsCheck {
  ok: boolean;
  detail: string;
}

export function collectOpsStatus() {
  const checks: Record<string, OpsCheck> = {};
  const web = service("support-tickets");
  checks.webService = { ok: web === "active", detail: web };
  const w = workerHealth();
  checks.worker = { ok: w.alive, detail: w.heartbeat ? `heartbeat ${w.ageSeconds}s ago` : "never started" };

  const ready = readiness();
  checks.database = { ok: ready.checks.database.ok, detail: ready.checks.database.detail ?? "ok" };

  const q = queueStats(getDb());
  const waitingSince = typeof q.oldestWaiting === "string" ? Date.parse(`${q.oldestWaiting.replace(" ", "T")}Z`) : null;
  const waitMin = waitingSince ? Math.round((Date.now() - waitingSince) / 60000) : 0;
  checks.draftQueue = { ok: waitMin <= 10, detail: `${Number(q.pending ?? 0) + Number(q.retry_wait ?? 0)} waiting${waitMin ? `, oldest ${waitMin} min` : ""}; ${q.failed ?? 0} failed in total` };

  const fs = statfsSync(dataDir());
  const freePct = Math.round((fs.bavail / fs.blocks) * 100);
  const freeGb = Math.round(((fs.bavail * fs.bsize) / 1024 ** 3) * 10) / 10;
  checks.disk = { ok: freePct >= DISK_MIN_FREE_PCT, detail: `${freeGb} GB free (${freePct}%)` };

  const latest = listBackups()[0];
  const backupAge = latest ? (Date.now() - Date.parse(latest.createdAt)) / 3600e3 : null;
  const lastRun = getState<{ ok: boolean; error?: string }>("task:backup");
  checks.backups = latest
    ? { ok: backupAge! <= BACKUP_MAX_AGE_HOURS && lastRun?.value.ok !== false, detail: `latest ${Math.round(backupAge! * 10) / 10} h ago${lastRun?.value.ok === false ? `; last run failed: ${lastRun.value.error}` : ""}` }
    : { ok: false, detail: lastRun?.value.error ?? "no backup yet" };
  const off = offsiteStatus();
  checks.offsiteBackups = !off.configured
    ? { ok: false, detail: `local only: ${off.missing.join(", ")} not set in .env.local` }
    : !off.latest
      ? { ok: false, detail: "no backup to upload yet" }
      : off.latestUploaded
        ? { ok: true, detail: "latest uploaded" }
        : { ok: false, detail: off.error ? `upload failed: ${off.error}` : "latest backup not uploaded yet" };

  const kb = kbHealth();
  checks.knowledgeBase = {
    ok: !!kb.indexBuiltAt && kb.index.state !== "failed" && kb.products.fresh,
    detail: !kb.indexBuiltAt ? "no index" : kb.index.state === "failed" ? `last re-index failed: ${kb.index.error}` : kb.products.fresh ? "ok" : "product articles older than 4 days",
  };

  const failedAlerts = Number((getDb().prepare(`SELECT count(*) AS c FROM alerts WHERE status = 'failed' AND created_at > datetime('now', '-1 day')`).get() as { c: number }).c);
  checks.alerts = { ok: failedAlerts === 0, detail: failedAlerts ? `${failedAlerts} alert email(s) failed in the last day` : "ok" };

  return { at: new Date().toISOString(), ok: Object.values(checks).every((c) => c.ok), checks };
}

export type OpsStatus = ReturnType<typeof collectOpsStatus>;

export function writeOpsStatus() {
  const status = collectOpsStatus();
  const path = join(dataDir(), "ops-status.json");
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(status, null, 2));
  renameSync(tmp, path);
  setState("ops", status);
  return status;
}

/** The last monitor report, with "stale" when the monitor itself stopped */
export function lastOpsStatus() {
  const s = getState<OpsStatus>("ops");
  if (!s) return { state: "missing" as const, status: null, ageSeconds: null };
  const ageSeconds = Math.round((Date.now() - Date.parse(s.updatedAt)) / 1000);
  return { state: ageSeconds > OPS_STALE_SECONDS ? ("stale" as const) : ("ok" as const), status: s.value, ageSeconds };
}
