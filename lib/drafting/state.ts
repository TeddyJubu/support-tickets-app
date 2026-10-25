// Read-only AI draft state (latest draft and job of a ticket). Takes the database handle so
// lib/sim-db.ts can include it in ticket details without a circular import.

import { isoFromSql } from "../db";
import type { DatabaseSync } from "node:sqlite";
import { normalizeLegacyStoreBrand } from "../kb/branding";

export interface DraftInfo {
  id: number;
  body: string;
  action: "reply" | "needs_staff";
  severity: string;
  sensitive: boolean;
  missingFacts: string[];
  staffNextStep: string | null;
  flags: string[];
  kbRefs: string[];
  state: "ready" | "used" | "dismissed" | "superseded";
  createdAt: string;
  /** The customer message it answers */
  messageId: number | null;
}

export interface DraftJobInfo {
  id: number;
  state: string;
  attempts: number;
  error: string | null;
  errorKind: string | null;
  runAfter: string | null;
  reason: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
}

export interface AiDraftState {
  draft: DraftInfo | null;
  job: DraftJobInfo | null;
}

type Row = Record<string, unknown>;
const iso = isoFromSql;
const json = <T>(v: unknown, fallback: T): T => {
  try {
    return v ? (JSON.parse(String(v)) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const toDraft = (r: Row): DraftInfo => ({
  id: Number(r.id),
  body: normalizeLegacyStoreBrand(String(r.body ?? "")),
  action: r.action === "needs_staff" ? "needs_staff" : "reply",
  severity: String(r.severity),
  sensitive: Number(r.sensitive) === 1,
  missingFacts: json<string[]>(r.missing_facts, []),
  staffNextStep: r.staff_next_step == null ? null : String(r.staff_next_step),
  flags: json<string[]>(r.flags, []),
  kbRefs: json<string[]>(r.kb_refs, []),
  state: String(r.state) as DraftInfo["state"],
  createdAt: iso(r.created_at)!,
  messageId: r.message_id == null ? null : Number(r.message_id),
});

/** Latest job and latest non-superseded draft for the ticket */
export function aiDraftState(d: DatabaseSync, ticketId: string): AiDraftState {
  const job = d.prepare(`SELECT * FROM jobs WHERE ticket_id = ? AND state != 'superseded' ORDER BY id DESC LIMIT 1`).get(ticketId) as Row | undefined;
  const draft = d
    .prepare(`SELECT * FROM drafts WHERE ticket_id = ? AND state != 'superseded' ORDER BY id DESC LIMIT 1`)
    .get(ticketId) as Row | undefined;
  const detail = json<Record<string, unknown>>(job?.detail, {});
  // Once the customer has been answered, a used or dismissed draft is history: don't show it
  const answered =
    draft &&
    draft.state !== "ready" &&
    d.prepare(`SELECT 1 FROM sim_messages WHERE ticket_id = ? AND author = 'agent' AND id > ?`).get(ticketId, Number(draft.message_id ?? 0));
  return {
    draft: draft && !answered ? toDraft(draft) : null,
    job: job
      ? {
          id: Number(job.id),
          state: String(job.state),
          attempts: Number(job.attempts),
          error: job.error == null ? null : String(job.error),
          errorKind: job.error_kind == null ? null : String(job.error_kind),
          runAfter: iso(job.run_after),
          reason: typeof detail.reason === "string" ? detail.reason : null,
          createdAt: iso(job.created_at),
          startedAt: iso(job.claimed_at),
        }
      : null,
  };
}

