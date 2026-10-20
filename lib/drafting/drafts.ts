// AI draft state for the inbox: the latest draft and job for a ticket, and staff actions on
// a draft (use, dismiss, restore). Drafts are never sent from here.

import { transaction } from "../db";
import { audit } from "../auth";
import { getDb } from "../sim-db";
import { toDraft } from "./state";

export { type AiDraftState, type DraftInfo, type DraftJobInfo } from "./state";

type Row = Record<string, unknown>;

export function getDraft(id: number) {
  const r = getDb().prepare(`SELECT * FROM drafts WHERE id = ?`).get(id) as Row | undefined;
  return r ? { ...toDraft(r), ticketId: String(r.ticket_id) } : null;
}

const ALLOWED: Record<string, string[]> = {
  ready: ["used", "dismissed"],
  dismissed: ["ready"],
  used: ["ready"],
};

/** used | dismissed | ready (restore). Superseded drafts can't change. */
export function setDraftState(id: number, next: "used" | "dismissed" | "ready", actor: string) {
  const d = getDb();
  return transaction(d, () => {
    const r = d.prepare(`SELECT * FROM drafts WHERE id = ?`).get(id) as Row | undefined;
    if (!r) return { error: "Draft not found", status: 404 } as const;
    if (!(ALLOWED[String(r.state)] ?? []).includes(next)) {
      return { error: r.state === "superseded" ? "A newer customer message replaced this draft" : `Draft is ${r.state}`, status: 409 } as const;
    }
    d.prepare(`UPDATE drafts SET state = ?, acted_by = ?, updated_at = datetime('now') WHERE id = ?`).run(next, actor, id);
    audit(actor, `draft_${next}`, String(r.ticket_id), { draftId: id });
    return { draft: toDraft(d.prepare(`SELECT * FROM drafts WHERE id = ?`).get(id) as Row) } as const;
  });
}
