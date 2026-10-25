// Numbers for the Overview page. Each part is computed on its own so one failure shows as
// "unavailable" without hiding the rest.

import { isoFromSql } from "./db";
import { getDb } from "./sim-db";
import { lessonStats } from "./learning";
import { lastOpsStatus } from "./ops/monitor";
import { queueStats } from "./drafting/queue";

type Row = Record<string, unknown>;
const iso = isoFromSql;

function part<T>(fn: () => T): { ok: true; data: T } | { ok: false; error: string } {
  try {
    return { ok: true, data: fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unavailable" };
  }
}

// Same rule as the inbox: snoozed tickets aren't active until they wake
const ACTIVE = `trashed_at IS NULL AND spam_at IS NULL AND status != 'closed' AND (snoozed_until IS NULL OR snoozed_until <= datetime('now'))`;

export function overview() {
  const d = getDb();
  return {
    escalations: part(() =>
      (d
        .prepare(
          `SELECT t.id, t.subject, t.priority, t.status, t.updated_at, u.display_name AS assignee,
                  (SELECT a.detail FROM audit_log a WHERE a.ticket_id = t.id AND a.action = 'triage'
                   AND a.actor IN ('classifier', 'worker') ORDER BY a.id DESC LIMIT 1) AS priority_detail
           FROM sim_tickets t
           LEFT JOIN staff_users u ON u.id = t.assignee_id
           WHERE ${ACTIVE.replace(/(trashed_at|spam_at|status|snoozed_until)/g, "t.$1")} AND t.priority IN ('critical', 'high')
           ORDER BY CASE t.priority WHEN 'critical' THEN 0 ELSE 1 END, t.updated_at DESC LIMIT 12`,
        )
        .all() as Row[]).map((r) => ({
        id: String(r.id),
        subject: r.subject == null ? null : String(r.subject),
        priority: String(r.priority),
        status: String(r.status),
        assignee: r.assignee == null ? null : String(r.assignee),
        priorityReason: (() => {
          try {
            const detail = JSON.parse(String(r.priority_detail ?? "")) as { reason?: unknown };
            return typeof detail.reason === "string" && detail.reason.trim() ? detail.reason.trim().slice(0, 240) : null;
          } catch {
            return null;
          }
        })(),
        updatedAt: iso(r.updated_at),
      })),
    ),
    workload: part(() => {
      const rows = d
        .prepare(
          `SELECT status, priority, count(*) AS c FROM sim_tickets WHERE trashed_at IS NULL AND spam_at IS NULL
           AND (snoozed_until IS NULL OR snoozed_until <= datetime('now')) GROUP BY status, priority`,
        )
        .all() as Row[];
      const byStatus: Record<string, number> = {};
      const openByPriority: Record<string, number> = {};
      for (const r of rows) {
        byStatus[String(r.status)] = (byStatus[String(r.status)] ?? 0) + Number(r.c);
        if (r.status !== "closed") openByPriority[String(r.priority)] = (openByPriority[String(r.priority)] ?? 0) + Number(r.c);
      }
      const unassigned = Number((d.prepare(`SELECT count(*) AS c FROM sim_tickets WHERE ${ACTIVE} AND assignee_id IS NULL`).get() as Row).c);
      return { byStatus, openByPriority, unassigned };
    }),
    ai: part(() => {
      const today = d
        .prepare(
          `SELECT count(*) AS created, sum(state = 'used') AS used, sum(state = 'dismissed') AS dismissed, sum(action = 'needs_staff') AS needsStaff
           FROM drafts WHERE created_at > datetime('now', '-1 day')`,
        )
        .get() as Row;
      return {
        last24h: { created: Number(today.created ?? 0), used: Number(today.used ?? 0), dismissed: Number(today.dismissed ?? 0), needsStaff: Number(today.needsStaff ?? 0) },
        queue: queueStats(d),
        queueCheckedAt: new Date().toISOString(),
      };
    }),
    activity: part(() =>
      (d.prepare(`SELECT COALESCE(u.display_name, a.actor) AS actor, a.action, a.ticket_id, a.at FROM audit_log a
                  LEFT JOIN staff_users u ON u.username = a.actor
                  WHERE a.actor NOT IN ('classifier', 'worker') AND a.action NOT IN ('login', 'send_access_on') ORDER BY a.id DESC LIMIT 20`).all() as Row[]).map((r) => ({
        actor: String(r.actor),
        action: String(r.action),
        ticketId: r.ticket_id == null ? null : String(r.ticket_id),
        at: iso(r.at),
      })),
    ),
    learning: part(() => lessonStats()),
    ops: part(() => lastOpsStatus()),
  };
}
