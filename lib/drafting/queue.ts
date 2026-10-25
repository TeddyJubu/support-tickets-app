// Durable draft-job queue in data/sim.db. Every function takes the database handle, so
// lib/sim-db.ts can enqueue inside its own transactions without a circular import.
//
// Lifecycle: pending → processing → done | skipped | superseded | failed
//            processing → retry_wait (transient AI error) → processing … (3 attempts max)
//            after 3 transient failures: retry_wait again in 15 min with fresh attempts (2 more rounds)
// A crashed worker's claim goes back to pending after 10 minutes (or to done if its draft
// was already saved).

import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db";
import { classify, SEVERITY_RANK, type Severity } from "../classifier";
import { urgentTicket } from "../notify";

export type JobState = "pending" | "processing" | "retry_wait" | "done" | "failed" | "superseded" | "skipped";
export type ErrorKind = "transient" | "auth" | "invalid" | "safety" | "stale";

export interface Job {
  id: number;
  ticketId: string;
  messageId: number | null;
  state: JobState;
  urgent: boolean;
  attempts: number;
  runAfter: string;
  error: string | null;
  errorKind: ErrorKind | null;
  detail: Record<string, unknown> | null;
}

export const MAX_ATTEMPTS = 3;
const STALE_MINUTES = 10;
const PRIORITY_WINDOW = 25;
const RETRY_DELAYS = [30, 120]; // seconds, after the 1st and 2nd failed attempt
// An AI outage outlasts three quick tries: try again later on its own instead of waiting for staff
export const AUTO_RETRY_ROUNDS = 2;
export const AUTO_RETRY_MINUTES = 15;

type Row = Record<string, unknown>;
const toJob = (r: Row): Job => ({
  id: Number(r.id),
  ticketId: String(r.ticket_id),
  messageId: r.message_id == null ? null : Number(r.message_id),
  state: String(r.state) as JobState,
  urgent: Number(r.urgent) === 1,
  attempts: Number(r.attempts),
  runAfter: String(r.run_after),
  error: r.error == null ? null : String(r.error),
  errorKind: (r.error_kind as ErrorKind) ?? null,
  detail: r.detail ? (JSON.parse(String(r.detail)) as Record<string, unknown>) : null,
});

export const autoDraftsEnabled = () => process.env.AUTO_DRAFTS !== "0";

/**
 * Called in the same transaction as a new customer message: supersedes waiting jobs and
 * unused drafts for the ticket, runs the classifier (escalate-only priority), queues a job.
 */
export function queueDraft(d: DatabaseSync, ticketId: string, messageId: number) {
  const ticket = d.prepare(`SELECT subject, priority, channel FROM sim_tickets WHERE id = ?`).get(ticketId) as Row | undefined;
  const message = d.prepare(`SELECT body FROM sim_messages WHERE id = ?`).get(messageId) as Row | undefined;
  if (!ticket || !message) return null;
  return transaction(d, () => {
    d.prepare(
      `UPDATE jobs SET state = 'superseded', updated_at = datetime('now'), finished_at = datetime('now')
       WHERE ticket_id = ? AND state IN ('pending', 'retry_wait')`,
    ).run(ticketId);
    d.prepare(`UPDATE drafts SET state = 'superseded', updated_at = datetime('now') WHERE ticket_id = ? AND state = 'ready'`).run(ticketId);

    const c = classify({ subject: String(ticket.subject ?? ""), message: String(message.body ?? "") });
    // Escalate only: never lower a priority someone (or an earlier message) set
    const current = (String(ticket.priority ?? "normal") as Severity) in SEVERITY_RANK ? (String(ticket.priority) as Severity) : "normal";
    // Only a real signal (high/critical) raises it: "normal" means "nothing found", not "set to normal"
    if (c.priority !== "normal" && SEVERITY_RANK[c.priority] > SEVERITY_RANK[current]) {
      d.prepare(`UPDATE sim_tickets SET priority = ? WHERE id = ?`).run(c.priority, ticketId);
      d.prepare(`INSERT INTO audit_log (actor, action, ticket_id, detail) VALUES ('classifier', 'triage', ?, ?)`).run(
        ticketId,
        JSON.stringify({ priority: c.priority, reason: c.reason }),
      );
    }
    if (c.notifyOwner && (c.priority === "high" || c.priority === "critical")) urgentTicket(d, ticketId, c.priority, c.reason);
    if (!autoDraftsEnabled()) return null;
    const urgent = c.sensitive && (c.priority === "high" || c.priority === "critical");
    const res = d
      .prepare(`INSERT INTO jobs (ticket_id, message_id, urgent, detail) VALUES (?, ?, ?, ?)`)
      .run(ticketId, messageId, urgent ? 1 : 0, JSON.stringify({ classifier: c }));
    return Number(res.lastInsertRowid);
  });
}

/** Claims the next runnable job: oldest first, but an urgent one within the next 25 goes ahead */
export function claimNextJob(d: DatabaseSync, workerId: string): Job | null {
  // AUTO_DRAFTS=0 also pauses jobs already queued (they wait until drafting is back on)
  if (!autoDraftsEnabled()) return null;
  return transaction(d, () => {
    const rows = d
      .prepare(
        `SELECT * FROM jobs WHERE state IN ('pending', 'retry_wait') AND run_after <= datetime('now')
         ORDER BY id LIMIT ?`,
      )
      .all(PRIORITY_WINDOW) as Row[];
    const pick = rows.find((r) => Number(r.urgent) === 1) ?? rows[0];
    if (!pick) return null;
    d.prepare(
      `UPDATE jobs SET state = 'processing', attempts = attempts + 1, claimed_at = datetime('now'), claimed_by = ?,
         updated_at = datetime('now') WHERE id = ?`,
    ).run(workerId, Number(pick.id));
    return toJob(d.prepare(`SELECT * FROM jobs WHERE id = ?`).get(Number(pick.id)) as Row);
  });
}

export function getJob(d: DatabaseSync, id: number) {
  const r = d.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as Row | undefined;
  return r ? toJob(r) : null;
}

export function finishJob(d: DatabaseSync, id: number, state: "done" | "skipped" | "superseded", detail?: Record<string, unknown>) {
  d.prepare(
    `UPDATE jobs SET state = ?, error = NULL, error_kind = NULL, finished_at = datetime('now'), updated_at = datetime('now'),
       detail = CASE WHEN ? IS NULL THEN detail ELSE json_patch(coalesce(detail, '{}'), ?) END
     WHERE id = ? AND state = 'processing'`,
  ).run(state, detail ? 1 : null, detail ? JSON.stringify(detail) : null, id);
}

/** Transient errors wait and retry (30 s, then 120 s); anything else, or the 3rd failure, stops */
export function failJob(d: DatabaseSync, id: number, kind: ErrorKind, message: string) {
  const job = getJob(d, id);
  if (!job) return null;
  const retry = kind === "transient" && job.attempts < MAX_ATTEMPTS;
  const rounds = Number(job.detail?.autoRetries ?? 0);
  if (kind === "transient" && !retry && rounds < AUTO_RETRY_ROUNDS) {
    d.prepare(
      `UPDATE jobs SET state = 'retry_wait', attempts = 0, run_after = datetime('now', ?), error = ?, error_kind = ?,
         detail = json_patch(coalesce(detail, '{}'), json_object('autoRetries', ?)), updated_at = datetime('now')
       WHERE id = ? AND state = 'processing'`,
    ).run(`+${AUTO_RETRY_MINUTES} minutes`, message.slice(0, 500), kind, rounds + 1, id);
    return "retry_wait";
  }
  if (retry) {
    const delay = RETRY_DELAYS[Math.min(job.attempts - 1, RETRY_DELAYS.length - 1)];
    d.prepare(
      `UPDATE jobs SET state = 'retry_wait', run_after = datetime('now', ?), error = ?, error_kind = ?, updated_at = datetime('now')
       WHERE id = ? AND state = 'processing'`,
    ).run(`+${delay} seconds`, message.slice(0, 500), kind, id);
  } else {
    d.prepare(
      `UPDATE jobs SET state = 'failed', error = ?, error_kind = ?, finished_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND state = 'processing'`,
    ).run(message.slice(0, 500), kind, id);
  }
  return retry ? "retry_wait" : "failed";
}

/** Claims abandoned by a crashed or killed worker */
export function recoverStaleJobs(d: DatabaseSync) {
  return transaction(d, () => {
    const stale = d
      .prepare(`SELECT * FROM jobs WHERE state = 'processing' AND claimed_at < datetime('now', ?)`)
      .all(`-${STALE_MINUTES} minutes`) as Row[];
    for (const r of stale) {
      const id = Number(r.id);
      // The draft was saved before the crash: keep it, don't run the model again
      if (d.prepare(`SELECT 1 FROM drafts WHERE job_id = ?`).get(id)) {
        d.prepare(`UPDATE jobs SET state = 'done', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
      } else if (Number(r.attempts) >= MAX_ATTEMPTS) {
        d.prepare(
          `UPDATE jobs SET state = 'failed', error = 'The worker stopped while drafting, three times', error_kind = 'stale',
             finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        ).run(id);
      } else {
        d.prepare(`UPDATE jobs SET state = 'pending', claimed_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
      }
    }
    return stale.length;
  });
}

/** Staff asked for a new draft: queue one for the latest customer message unless one is waiting */
export function retryDraft(d: DatabaseSync, ticketId: string) {
  return transaction(d, () => {
    const waiting = d
      .prepare(`SELECT id FROM jobs WHERE ticket_id = ? AND state IN ('pending', 'processing', 'retry_wait')`)
      .get(ticketId) as Row | undefined;
    if (waiting) return { queued: false, jobId: Number(waiting.id), reason: "A draft is already being prepared" };
    const latest = d
      .prepare(`SELECT max(id) AS id FROM sim_messages WHERE ticket_id = ? AND author = 'customer'`)
      .get(ticketId) as Row;
    if (latest.id == null) return { queued: false, jobId: null, reason: "There is no customer message to answer" };
    d.prepare(`UPDATE drafts SET state = 'superseded', updated_at = datetime('now') WHERE ticket_id = ? AND state = 'ready'`).run(ticketId);
    const res = d.prepare(`INSERT INTO jobs (ticket_id, message_id, detail) VALUES (?, ?, '{"retry":true}')`).run(ticketId, Number(latest.id));
    return { queued: true, jobId: Number(res.lastInsertRowid), reason: null };
  });
}

export function queueStats(d: DatabaseSync) {
  const rows = d.prepare(`SELECT state, count(*) AS c FROM jobs GROUP BY state`).all() as Row[];
  const oldest = d
    // Waiting since it became due: a job scheduled for later isn't a backlog yet
    .prepare(`SELECT min(run_after) AS t FROM jobs WHERE state IN ('pending', 'retry_wait') AND run_after <= datetime('now')`)
    .get() as Row;
  return {
    ...Object.fromEntries(rows.map((r) => [String(r.state), Number(r.c)])),
    oldestWaiting: oldest.t == null ? null : String(oldest.t),
  } as Record<string, number | string | null>;
}
