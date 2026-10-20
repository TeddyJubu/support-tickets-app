// Notice Board: short, temporary store facts from the owner ("pickup closed Friday").
// Active notices are given to the AI with every KB search and override KB articles.

import { isoFromSql } from "../db";
import { getDb, nowSql } from "../sim-db";
import { audit } from "../auth";

export interface Notice {
  id: number;
  title: string;
  body: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  endedAt: string | null;
  active: boolean;
}

type Row = Record<string, unknown>;
const iso = isoFromSql;

function toNotice(r: Row): Notice {
  const now = nowSql();
  return {
    id: Number(r.id),
    title: String(r.title),
    body: String(r.body),
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at)!,
    expiresAt: iso(r.expires_at),
    endedAt: iso(r.ended_at),
    active: r.ended_at == null && (r.expires_at == null || String(r.expires_at) > now),
  };
}

const ACTIVE = `ended_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))`;

export function activeNotices(): Notice[] {
  return (getDb().prepare(`SELECT * FROM notices WHERE ${ACTIVE} ORDER BY id DESC`).all() as Row[]).map(toNotice);
}

/** Active first, then the 30 most recent ended or expired */
export function listNotices(): Notice[] {
  const d = getDb();
  const active = d.prepare(`SELECT * FROM notices WHERE ${ACTIVE} ORDER BY id DESC`).all() as Row[];
  const past = d.prepare(`SELECT * FROM notices WHERE NOT (${ACTIVE}) ORDER BY id DESC LIMIT 30`).all() as Row[];
  return [...active, ...past].map(toNotice);
}

export function validateNotice(input: { title?: unknown; body?: unknown; expiresAt?: unknown }) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title || title.length > 120) return { error: "Title: 1–120 characters" };
  if (!body || body.length > 2000) return { error: "Notice: 1–2000 characters" };
  let expiresAt: string | null = null;
  if (input.expiresAt != null && input.expiresAt !== "") {
    const when = new Date(String(input.expiresAt));
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) return { error: "The end date must be in the future" };
    if (when.getTime() > Date.now() + 365 * 86400e3) return { error: "End within a year" };
    expiresAt = when.toISOString().slice(0, 19).replace("T", " ");
  }
  return { title, body, expiresAt };
}

export function createNotice(input: { title: string; body: string; expiresAt: string | null }, actor: string) {
  const res = getDb()
    .prepare(`INSERT INTO notices (title, body, created_by, expires_at) VALUES (?, ?, ?, ?)`)
    .run(input.title, input.body, actor, input.expiresAt);
  audit(actor, "notice_create", null, { id: Number(res.lastInsertRowid), title: input.title });
  return toNotice(getDb().prepare(`SELECT * FROM notices WHERE id = ?`).get(Number(res.lastInsertRowid)) as Row);
}

export function endNotice(id: number, actor: string) {
  const res = getDb()
    .prepare(`UPDATE notices SET ended_at = datetime('now'), ended_by = ? WHERE id = ? AND ended_at IS NULL`)
    .run(actor, id);
  if (res.changes) audit(actor, "notice_end", null, { id });
  return res.changes > 0;
}

/** Removes notices that ended or expired more than 90 days ago (run by the worker) */
export function pruneNotices() {
  return getDb()
    .prepare(
      `DELETE FROM notices WHERE coalesce(ended_at, expires_at) < datetime('now', '-90 days')`,
    )
    .run().changes;
}
