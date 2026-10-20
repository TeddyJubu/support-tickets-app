// Dead-man's switch for the worker, run by its own systemd timer every 5 minutes
// (deploy/systemd/support-tickets-heartbeat.timer): if the worker's heartbeat is stale,
// email the owner once; when it comes back, email once more. It sends alerts itself,
// because the worker that normally does can't while it's down.

import { getDb } from "@/lib/sim-db";
import { deliverAlerts } from "@/lib/alerts";
import { createAlert, notifyOwners, siteUrl } from "@/lib/notify";
import { getState, setState, workerHealth } from "@/lib/worker/state";
import { loadEnv } from "./env";

loadEnv();
const health = workerHealth();
const previous = getState<{ down: boolean; since: string | null }>("heartbeat_check")?.value ?? { down: false, since: null };
const now = new Date().toISOString();

if (!health.alive && !previous.down) {
  const since = health.heartbeat ? `${health.ageSeconds} seconds ago` : "never";
  const d = getDb();
  createAlert(d, {
    kind: "worker_down",
    subject: "[Helpdesk] AI drafting worker stopped",
    body: `The helpdesk worker hasn't checked in (last heartbeat: ${since}). New tickets still arrive and can be answered by hand, but no AI drafts or alerts are being prepared.\n\nOn the server: npm run helpdesk -- worker, then sudo systemctl status support-tickets-worker\n\n${siteUrl()}/overview`,
    dedupeKey: `worker:down:${now}`,
  });
  notifyOwners(d, "alert", null, "The AI drafting worker stopped");
  setState("heartbeat_check", { down: true, since: now });
  console.log(`worker DOWN (last heartbeat ${since}): alert queued`);
} else if (health.alive && previous.down) {
  const d = getDb();
  createAlert(d, {
    kind: "worker_recovered",
    subject: "[Helpdesk] AI drafting worker is running again",
    body: `The helpdesk worker is checking in again (it stopped at ${previous.since}). Drafts that waited are being prepared now.`,
    dedupeKey: `worker:up:${now}`,
  });
  setState("heartbeat_check", { down: false, since: null });
  console.log("worker recovered: alert queued");
} else {
  console.log(`worker ${health.alive ? "alive" : "still down"}`);
}

const sent = await deliverAlerts();
if (sent.sent || sent.failed || sent.skipped) console.log(`alerts: ${JSON.stringify(sent)}`);
