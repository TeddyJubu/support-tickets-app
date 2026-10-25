// Delivers owner alert emails through SES (from the support address to ALERT_EMAIL).
// Run by the worker every minute and by the heartbeat check. Failed attempts retry at
// 1, 5 and 30 minutes, then stop as "failed" (staff can retry from the Alerts page).
// Without ALERT_EMAIL alerts are kept in-app only ("skipped").

import { transaction, isoFromSql } from "./db";
import { audit } from "./auth";
import { sendEmail } from "./aws-email";
import { getDb } from "./sim-db";
import { createAlert } from "./notify";
import { storeSettings } from "./settings";

const RETRY_MINUTES = [1, 5, 30];
const MAX_PER_HOUR = 30;

type Row = Record<string, unknown>;
const iso = isoFromSql;

export const alertRecipients = () =>
  (process.env.ALERT_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s));

export interface AlertRow {
  id: number;
  kind: string;
  ticketId: string | null;
  severity: string | null;
  subject: string;
  status: string;
  attempts: number;
  recipient: string | null;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
  nextAttemptAt: string | null;
}

const toAlert = (r: Row): AlertRow => ({
  id: Number(r.id),
  kind: String(r.kind),
  ticketId: r.ticket_id == null ? null : String(r.ticket_id),
  severity: r.severity == null ? null : String(r.severity),
  subject: String(r.subject),
  status: String(r.status),
  attempts: Number(r.attempts),
  recipient: r.recipient == null ? null : String(r.recipient),
  lastError: r.last_error == null ? null : String(r.last_error),
  createdAt: iso(r.created_at)!,
  sentAt: iso(r.sent_at),
  nextAttemptAt: iso(r.next_attempt_at),
});

function alertRateLimit(d: ReturnType<typeof getDb>) {
  const sent = Number((d.prepare(`SELECT count(*) AS c FROM alerts WHERE status = 'sent' AND sent_at > datetime('now', '-1 hour')`).get() as Row).c);
  if (sent < MAX_PER_HOUR) return { rateLimited: false, nextAttemptAt: null as string | null };
  // Leave one minute after the first send expires to account for SQLite's second precision
  // and the worker's once-a-minute cadence. deliverAlerts still checks the limit before send.
  const next = d.prepare(
    `SELECT datetime(min(sent_at), '+61 minutes') AS next_attempt_at
     FROM alerts WHERE status = 'sent' AND sent_at > datetime('now', '-1 hour')`,
  ).get() as Row;
  return { rateLimited: true, nextAttemptAt: next.next_attempt_at == null ? null : String(next.next_attempt_at) };
}

export function listAlerts(offset = 0, limit = 25) {
  const d = getDb();
  const total = Number((d.prepare(`SELECT count(*) AS c FROM alerts`).get() as Row).c);
  const rows = d.prepare(`SELECT * FROM alerts ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset) as Row[];
  const rateLimit = alertRateLimit(d);
  const alerts = rows.map((row) => {
    const alert = toAlert(row);
    if (alert.status !== "skipped" || alert.lastError !== "Too many alerts this hour") return alert;
    return {
      ...alert,
      lastError: "Rate limit: 30 alert emails per hour. Retry only after the time shown; the cap is checked before sending.",
      nextAttemptAt: rateLimit.rateLimited && rateLimit.nextAttemptAt ? iso(rateLimit.nextAttemptAt) : new Date().toISOString(),
    };
  });
  return { alerts, total, offset, limit, recipients: alertRecipients().length };
}

/** Sends due alerts. Returns counts; never throws. */
export async function deliverAlerts(send: typeof sendEmail = sendEmail) {
  const d = getDb();
  const recipients = alertRecipients();
  // A send interrupted by a crash or restart: try it again (a possible duplicate beats a lost alert)
  d.prepare(
    `UPDATE alerts SET status = 'pending', last_error = 'Interrupted while sending: retrying'
     WHERE status = 'sending' AND next_attempt_at < datetime('now', '-10 minutes')`,
  ).run();
  const due = d
    .prepare(`SELECT * FROM alerts WHERE status = 'pending' AND next_attempt_at <= datetime('now') ORDER BY id LIMIT 20`)
    .all() as Row[];
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const a of due) {
    const id = Number(a.id);
    if (!recipients.length) {
      d.prepare(`UPDATE alerts SET status = 'skipped', last_error = 'No ALERT_EMAIL configured: in-app only' WHERE id = ?`).run(id);
      result.skipped++;
      continue;
    }
    const rateLimit = alertRateLimit(d);
    if (rateLimit.rateLimited) {
      d.prepare(`UPDATE alerts SET status = 'skipped', last_error = ?, next_attempt_at = ? WHERE id = ?`).run(
        "Rate limit: 30 alert emails per hour. Retry after the time shown; the cap is checked again before sending.",
        rateLimit.nextAttemptAt,
        id,
      );
      result.skipped++;
      continue;
    }
    // Claim it, so the worker and the heartbeat check never send the same alert twice
    const claimed = transaction(d, () => d.prepare(`UPDATE alerts SET status = 'sending', attempts = attempts + 1, next_attempt_at = datetime('now') WHERE id = ? AND status = 'pending'`).run(id).changes);
    if (!claimed) continue;
    try {
      for (const to of recipients) await send({ to, subject: String(a.subject), text: String(a.body) });
      d.prepare(`UPDATE alerts SET status = 'sent', sent_at = datetime('now'), recipient = ?, last_error = NULL WHERE id = ?`).run(recipients.join(", "), id);
      result.sent++;
    } catch (err) {
      const attempts = Number(a.attempts) + 1;
      const retry = attempts <= RETRY_MINUTES.length;
      d.prepare(
        `UPDATE alerts SET status = ?, last_error = ?, next_attempt_at = datetime('now', ?) WHERE id = ?`,
      ).run(retry ? "pending" : "failed", (err instanceof Error ? err.message : String(err)).slice(0, 300), `+${RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)]} minutes`, id);
      result.failed++;
    }
  }
  return result;
}

/** Staff retry a failed or skipped alert without bypassing the hourly delivery cap. */
export function retryAlert(id: number, actor: string) {
  const d = getDb();
  const limit = alertRateLimit(d);
  const nextAttemptAt = limit.rateLimited ? limit.nextAttemptAt : null;
  const error = limit.rateLimited
    ? "Rate limit: 30 alert emails per hour. Retry scheduled after the time shown; the cap is checked again before sending."
    : null;
  const res = d
    .prepare(`UPDATE alerts SET status = 'pending', next_attempt_at = COALESCE(?, datetime('now')), last_error = ? WHERE id = ? AND status IN ('failed', 'skipped')`)
    .run(nextAttemptAt, error, id);
  if (res.changes) audit(actor, "alert_retry", null, { alertId: id, rateLimited: limit.rateLimited, nextAttemptAt: nextAttemptAt ? iso(nextAttemptAt) : null });
  return res.changes ? { ok: true as const, rateLimited: limit.rateLimited, nextAttemptAt: nextAttemptAt ? iso(nextAttemptAt) : null } : { ok: false as const };
}

export function sendTestAlert(actor: string) {
  const ok = createAlert(getDb(), {
    kind: "test",
    subject: "[Helpdesk] Test alert",
    body: `This is a test alert from the ${storeSettings().name} helpdesk, requested by ${actor}. Alerts for urgent tickets and a stopped worker come to this address.`,
    dedupeKey: `test:${Date.now()}`,
  });
  audit(actor, "alert_test");
  return ok;
}
