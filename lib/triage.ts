// Ticket triage: status, priority, assignee, tags, snooze, read state, trash, spam, subject.
// One validated change set applies to one ticket or many (bulk), atomically, and every
// change is written to the audit log.

import { toSqlTime, transaction } from "./db";
import { audit } from "./auth";
import { getDb, nowSql } from "./sim-db";
import { PRIORITIES } from "./helpdesk-types";
import { notifyUser } from "./notify";

export interface TicketChanges {
  status?: "open" | "pending" | "closed";
  priority?: string;
  /** a staff id, or null to unassign */
  assigneeId?: number | null;
  /** replace all tags */
  tags?: string[];
  addTag?: string;
  removeTag?: string;
  /** ISO time to snooze until, or null to wake */
  snoozedUntil?: string | null;
  /** for the acting staff member only */
  read?: boolean;
  trashed?: boolean;
  spam?: boolean;
  subject?: string;
}

const KEYS: Array<keyof TicketChanges> = [
  "status", "priority", "assigneeId", "tags", "addTag", "removeTag", "snoozedUntil", "read", "trashed", "spam", "subject",
];
const MAX_SNOOZE_DAYS = 90;

const cleanTag = (t: unknown) =>
  typeof t === "string" ? t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40) : "";

/** Checks a change set from a request body; returns the cleaned changes or an error message */
export function parseChanges(input: unknown): { changes: TicketChanges } | { error: string } {
  if (!input || typeof input !== "object") return { error: "Send a JSON object of changes" };
  const raw = input as Record<string, unknown>;
  const unknown = Object.keys(raw).filter((k) => !KEYS.includes(k as keyof TicketChanges));
  if (unknown.length) return { error: `Unknown field: ${unknown.join(", ")}` };
  const changes: TicketChanges = {};
  if ("status" in raw) {
    if (!["open", "pending", "closed"].includes(String(raw.status))) return { error: "status must be open, pending or closed" };
    changes.status = raw.status as TicketChanges["status"];
  }
  if ("priority" in raw) {
    if (!(PRIORITIES as string[]).includes(String(raw.priority))) return { error: `priority must be ${PRIORITIES.join(", ")}` };
    changes.priority = String(raw.priority);
  }
  if ("assigneeId" in raw) {
    if (raw.assigneeId === null) changes.assigneeId = null;
    else {
      const id = Number(raw.assigneeId);
      const staff = Number.isInteger(id)
        ? getDb().prepare(`SELECT 1 FROM staff_users WHERE id = ? AND disabled_at IS NULL`).get(id)
        : null;
      if (!staff) return { error: "assigneeId must be an active staff member" };
      changes.assigneeId = id;
    }
  }
  if ("tags" in raw) {
    if (!Array.isArray(raw.tags) || raw.tags.length > 20) return { error: "tags must be a list of up to 20" };
    changes.tags = [...new Set(raw.tags.map(cleanTag).filter(Boolean))];
  }
  for (const key of ["addTag", "removeTag"] as const) {
    if (key in raw) {
      const tag = cleanTag(raw[key]);
      if (!tag) return { error: `${key} must be a tag name` };
      changes[key] = tag;
    }
  }
  if ("snoozedUntil" in raw) {
    if (raw.snoozedUntil === null) changes.snoozedUntil = null;
    else {
      const when = new Date(String(raw.snoozedUntil));
      if (Number.isNaN(when.getTime())) return { error: "snoozedUntil must be a date and time" };
      if (when.getTime() <= Date.now()) return { error: "Snooze until a time in the future" };
      if (when.getTime() > Date.now() + MAX_SNOOZE_DAYS * 86400e3) return { error: `Snooze for at most ${MAX_SNOOZE_DAYS} days` };
      changes.snoozedUntil = toSqlTime(when);
    }
  }
  for (const key of ["read", "trashed", "spam"] as const) {
    if (key in raw) {
      if (typeof raw[key] !== "boolean") return { error: `${key} must be true or false` };
      changes[key] = raw[key] as boolean;
    }
  }
  if ("subject" in raw) {
    const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
    if (!subject || subject.length > 300) return { error: "subject must be 1–300 characters" };
    changes.subject = subject;
  }
  if (!Object.keys(changes).length) return { error: "Nothing to change" };
  return { changes };
}

/**
 * Applies changes to every ticket in ids (all or nothing). actor is the audit name; userId is the
 * staff member for read state (null for the CLI). Returns the ids that exist.
 */
export function applyChanges(ids: string[], changes: TicketChanges, actor: string, userId: number | null) {
  const d = getDb();
  return transaction(d, () => {
    const found: string[] = [];
    for (const id of ids) {
      if (!d.prepare(`SELECT 1 FROM sim_tickets WHERE id = ?`).get(id)) continue;
      found.push(id);
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      const set = (sql: string, ...values: (string | number | null)[]) => {
        sets.push(sql);
        params.push(...values);
      };
      if (changes.status) {
        set(`status = ?`, changes.status);
        set(`closed_at = CASE WHEN ? = 'closed' THEN coalesce(closed_at, datetime('now')) ELSE NULL END`, changes.status);
      }
      if (changes.priority) set(`priority = ?`, changes.priority);
      if (changes.assigneeId !== undefined) set(`assignee_id = ?`, changes.assigneeId);
      if (changes.snoozedUntil !== undefined) set(`snoozed_until = ?`, changes.snoozedUntil);
      if (changes.trashed !== undefined) set(`trashed_at = ${changes.trashed ? "coalesce(trashed_at, datetime('now'))" : "NULL"}`);
      if (changes.spam !== undefined) set(`spam_at = ${changes.spam ? "coalesce(spam_at, datetime('now'))" : "NULL"}`);
      if (changes.subject) set(`subject = ?`, changes.subject);
      // Read state is personal and doesn't count as ticket activity
      const touchesTicket = sets.length > 0 || changes.tags || changes.addTag || changes.removeTag;
      if (touchesTicket) {
        d.prepare(`UPDATE sim_tickets SET ${[...sets, "updated_at = datetime('now')"].join(", ")} WHERE id = ?`).run(...params, id);
      }
      if (changes.tags) {
        d.prepare(`DELETE FROM ticket_tags WHERE ticket_id = ?`).run(id);
        for (const tag of changes.tags) d.prepare(`INSERT OR IGNORE INTO ticket_tags (ticket_id, tag) VALUES (?, ?)`).run(id, tag);
      }
      if (changes.addTag) d.prepare(`INSERT OR IGNORE INTO ticket_tags (ticket_id, tag) VALUES (?, ?)`).run(id, changes.addTag);
      if (changes.removeTag) d.prepare(`DELETE FROM ticket_tags WHERE ticket_id = ? AND tag = ?`).run(id, changes.removeTag);
      if (changes.read !== undefined && userId) setRead(id, userId, changes.read);
      // Someone else assigned it to you
      if (changes.assigneeId && changes.assigneeId !== userId) {
        const subject = (d.prepare(`SELECT subject FROM sim_tickets WHERE id = ?`).get(id) as { subject: string | null }).subject;
        notifyUser(d, changes.assigneeId, "assigned", id, `${actor} assigned ${id} to you: ${subject ?? ""}`);
      }
      const logged = Object.fromEntries(Object.entries(changes).filter(([k]) => k !== "read"));
      if (Object.keys(logged).length) audit(actor, "triage", id, logged);
    }
    return found;
  });
}

export function setRead(ticketId: string, userId: number, read: boolean) {
  if (read) {
    getDb()
      .prepare(
        `INSERT INTO ticket_reads (ticket_id, user_id, read_at) VALUES (?, ?, ?)
         ON CONFLICT (ticket_id, user_id) DO UPDATE SET read_at = excluded.read_at`,
      )
      .run(ticketId, userId, nowSql());
  } else {
    getDb().prepare(`DELETE FROM ticket_reads WHERE ticket_id = ? AND user_id = ?`).run(ticketId, userId);
  }
}

/** Tags in use, most common first (for pickers and filters) */
export function allTags(limit = 100) {
  return (
    getDb().prepare(`SELECT tag, count(*) AS c FROM ticket_tags GROUP BY tag ORDER BY c DESC, tag LIMIT ?`).all(limit) as Array<{
      tag: string;
      c: number;
    }>
  ).map((r) => ({ tag: r.tag, count: Number(r.c) }));
}
