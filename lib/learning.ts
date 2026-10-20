// Learning loop: every delivered staff reply becomes a lesson (customer message, AI draft,
// what was actually sent). The owner approves the good ones; each night approved lessons are
// masked and written to data/kb/learned/ as examples the AI can learn tone and structure from.
// Raw lessons stay in the database only, never in the KB.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transaction, isoFromSql } from "./db";
import { audit } from "./auth";
import { getDb } from "./sim-db";
import { kbDir } from "./kb/files";
import { maskWithNames } from "./pii";

type Row = Record<string, unknown>;
const iso = isoFromSql;

export interface Lesson {
  id: number;
  ticketId: string;
  subject: string | null;
  intent: string | null;
  /** Masked: the lessons view never shows raw personal data */
  customerMessage: string;
  aiDraft: string | null;
  finalText: string;
  edited: boolean;
  createdBy: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected" | "promoted";
  reviewedBy: string | null;
  kbPath: string | null;
}

const names = (r: Row) => JSON.parse(String(r.customer_names ?? "[]")) as string[];

function toLesson(r: Row): Lesson {
  const n = names(r);
  return {
    id: Number(r.id),
    ticketId: String(r.ticket_id),
    subject: r.subject == null ? null : maskWithNames(String(r.subject), n),
    intent: r.intent == null ? null : String(r.intent),
    customerMessage: maskWithNames(String(r.customer_message), n),
    aiDraft: r.ai_draft == null ? null : maskWithNames(String(r.ai_draft), n),
    finalText: maskWithNames(String(r.final_text), n),
    edited: Number(r.edited) === 1,
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at)!,
    status: String(r.status) as Lesson["status"],
    reviewedBy: r.reviewed_by == null ? null : String(r.reviewed_by),
    kbPath: r.kb_path == null ? null : String(r.kb_path),
  };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Called after a reply is confirmed delivered. Idempotent per send. */
export function captureLesson(input: { ticketId: string; sendKey: string; finalText: string; actor: string }) {
  const d = getDb();
  const t = d
    .prepare(
      `SELECT t.subject, t.ai_intent, c.first_name, c.last_name, c.email FROM sim_tickets t
       LEFT JOIN sim_customers c ON c.id = t.customer_id WHERE t.id = ?`,
    )
    .get(input.ticketId) as Row | undefined;
  if (!t) return null;
  // The customer message this reply answered, and the AI draft for it if there was one
  const sourceId = (d.prepare(`SELECT source_message_id FROM sim_email_outbox WHERE idem_key = ?`).get(input.sendKey) as Row | undefined)
    ?.source_message_id;
  const question = d
    .prepare(
      sourceId != null
        ? `SELECT id, body FROM sim_messages WHERE id = ?`
        : `SELECT id, body FROM sim_messages WHERE ticket_id = ? AND author = 'customer' ORDER BY id DESC LIMIT 1`,
    )
    .get(sourceId != null ? Number(sourceId) : input.ticketId) as Row | undefined;
  if (!question) return null;
  const draft = d
    .prepare(`SELECT body FROM drafts WHERE ticket_id = ? AND message_id = ? AND body != '' ORDER BY id DESC LIMIT 1`)
    .get(input.ticketId, Number(question.id)) as Row | undefined;
  const aiDraft = draft ? String(draft.body) : null;
  const res = d
    .prepare(
      `INSERT OR IGNORE INTO lessons (ticket_id, send_key, subject, intent, customer_message, ai_draft, final_text, edited, customer_names, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.ticketId, input.sendKey, t.subject == null ? null : String(t.subject), t.ai_intent == null ? null : String(t.ai_intent),
      String(question.body), aiDraft, input.finalText, aiDraft && norm(aiDraft) !== norm(input.finalText) ? 1 : 0,
      JSON.stringify([[t.first_name, t.last_name].filter(Boolean).join(" "), String(t.email ?? "").split("@")[0]].filter(Boolean)),
      input.actor,
    );
  return res.changes ? Number(res.lastInsertRowid) : null;
}

export function listLessons(status?: Lesson["status"], limit = 50) {
  const rows = (
    status
      ? getDb().prepare(`SELECT * FROM lessons WHERE status = ? ORDER BY id DESC LIMIT ?`).all(status, limit)
      : getDb().prepare(`SELECT * FROM lessons ORDER BY id DESC LIMIT ?`).all(limit)
  ) as Row[];
  return rows.map(toLesson);
}

export function lessonStats() {
  const rows = getDb().prepare(`SELECT status, count(*) AS c, sum(edited) AS e FROM lessons GROUP BY status`).all() as Row[];
  const by = Object.fromEntries(rows.map((r) => [String(r.status), Number(r.c)]));
  const total = rows.reduce((s, r) => s + Number(r.c), 0);
  const edited = rows.reduce((s, r) => s + Number(r.e ?? 0), 0);
  const withDraft = Number((getDb().prepare(`SELECT count(*) AS c FROM lessons WHERE ai_draft IS NOT NULL`).get() as Row).c);
  return {
    total,
    pending: by.pending ?? 0,
    approved: by.approved ?? 0,
    rejected: by.rejected ?? 0,
    promoted: by.promoted ?? 0,
    withAiDraft: withDraft,
    aiDraftEdited: edited,
  };
}

export function reviewLesson(id: number, decision: "approved" | "rejected", actor: string) {
  const res = getDb()
    .prepare(`UPDATE lessons SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND status IN ('pending', 'approved', 'rejected')`)
    .run(decision, actor, id);
  if (res.changes) audit(actor, `lesson_${decision}`, null, { lessonId: id });
  return res.changes > 0;
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "reply";

function exemplar(l: Row) {
  const n = names(l);
  const intent = l.intent ? String(l.intent).split("::").filter((p) => p && p !== "Other").join(" / ") : "general question";
  const subject = maskWithNames(String(l.subject ?? "(no subject)"), n).replace(/[\r\n]/g, " ");
  return [
    "---",
    `title: Approved reply — ${subject.replace(/"/g, "'").slice(0, 100)}`,
    "category: learned",
    "status: confirmed",
    `tags: [learned, exemplar, ${slug(intent)}]`,
    "---",
    "",
    "## Customer asked",
    "",
    maskWithNames(String(l.customer_message), n).slice(0, 2500),
    "",
    "## Reply staff sent (approved example: mirror tone and structure, verify facts against current policy)",
    "",
    maskWithNames(String(l.final_text), n).slice(0, 2500),
    "",
  ].join("\n");
}

/** Nightly: write approved lessons as masked examples into data/kb/learned/. Returns how many. */
export function promoteApprovedLessons() {
  const d = getDb();
  const approved = d.prepare(`SELECT * FROM lessons WHERE status = 'approved' ORDER BY id LIMIT 200`).all() as Row[];
  if (!approved.length) return 0;
  const dir = join(kbDir(), "learned");
  mkdirSync(dir, { recursive: true });
  let promoted = 0;
  for (const l of approved) {
    const name = `lesson-${Number(l.id)}-${slug(String(l.intent ?? "reply"))}.md`;
    const path = join(dir, name);
    // Claim it while still approved: a lesson rejected meanwhile is skipped, not published
    const claimed = transaction(d, () =>
      d.prepare(`UPDATE lessons SET status = 'promoted', promoted_at = datetime('now'), kb_path = ? WHERE id = ? AND status = 'approved'`).run(`learned/${name}`, Number(l.id)).changes,
    );
    if (!claimed) continue;
    try {
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, exemplar(l));
      renameSync(tmp, path);
      promoted++;
    } catch (err) {
      d.prepare(`UPDATE lessons SET status = 'approved', promoted_at = NULL, kb_path = NULL WHERE id = ?`).run(Number(l.id));
      throw err;
    }
  }
  return promoted;
}
