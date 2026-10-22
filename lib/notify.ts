// In-app notifications and owner alerts, recorded in the same transaction as the event that
// causes them. Functions take the database handle so lib/sim-db.ts and the queue can call
// them inside their transactions. Delivery of alert emails is lib/alerts.ts.

import type { DatabaseSync } from "node:sqlite";

export type NotificationKind = "reply" | "assigned" | "urgent" | "alert";

export function notifyUser(d: DatabaseSync, userId: number, kind: NotificationKind, ticketId: string | null, text: string) {
  d.prepare(`INSERT INTO notifications (user_id, kind, ticket_id, text) VALUES (?, ?, ?, ?)`).run(userId, kind, ticketId, text.slice(0, 300));
}

export function notifyOwners(d: DatabaseSync, kind: NotificationKind, ticketId: string | null, text: string, except?: number | null) {
  const owners = d.prepare(`SELECT id FROM staff_users WHERE role = 'owner' AND disabled_at IS NULL`).all() as Array<{ id: number }>;
  for (const o of owners) if (Number(o.id) !== except) notifyUser(d, Number(o.id), kind, ticketId, text);
}

export interface AlertInput {
  kind: "urgent_ticket" | "worker_down" | "worker_recovered" | "test" | "shopify";
  ticketId?: string | null;
  severity?: string | null;
  subject: string;
  body: string;
  /** One alert per key, ever: repeated events don't re-alert */
  dedupeKey: string;
}

/** Queues an owner alert email; returns false when an alert with this key already exists */
export function createAlert(d: DatabaseSync, a: AlertInput) {
  const res = d
    .prepare(
      `INSERT OR IGNORE INTO alerts (kind, ticket_id, severity, subject, body, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(a.kind, a.ticketId ?? null, a.severity ?? null, a.subject.slice(0, 200), a.body.slice(0, 4000), a.dedupeKey);
  return res.changes > 0;
}

export const siteUrl = () => (process.env.HELPDESK_PUBLIC_URL || "https://helpdesk.teddyonfriday.com").replace(/\/$/, "");

/** Urgent ticket: owner alert (once per ticket and severity) plus in-app notifications */
export function urgentTicket(d: DatabaseSync, ticketId: string, severity: string, reason: string) {
  const t = d.prepare(`SELECT subject, assignee_id FROM sim_tickets WHERE id = ?`).get(ticketId) as
    | { subject: string | null; assignee_id: number | null }
    | undefined;
  if (!t) return;
  const label = severity === "critical" ? "Critical" : "High priority";
  const created = createAlert(d, {
    kind: "urgent_ticket",
    ticketId,
    severity,
    dedupeKey: `ticket:${ticketId}:${severity}`,
    subject: `[Helpdesk] ${label}: ${ticketId} ${t.subject ?? ""}`.trim(),
    // No customer message text in email: the reason and a link are enough
    body: `${label} ticket ${ticketId}: "${t.subject ?? "(no subject)"}"\n\nWhy: ${reason}\n\nOpen it: ${siteUrl()}/?ticket=${encodeURIComponent(ticketId)}\n\nAn AI draft is being prepared for review. Nothing has been sent to the customer.`,
  });
  if (!created) return;
  notifyOwners(d, "urgent", ticketId, `${label}: ${ticketId} ${t.subject ?? ""}`, t.assignee_id);
  if (t.assignee_id) notifyUser(d, Number(t.assignee_id), "urgent", ticketId, `${label}: ${ticketId} ${t.subject ?? ""}`);
}
