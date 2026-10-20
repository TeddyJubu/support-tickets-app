// Safe sending: the only way staff replies reach a customer (email) or a simulated customer.
//
//   1. "Read & write": a 30-minute send grant bound to the browser session (stored as a hash).
//   2. Review: the server records exactly what will be sent, to whom, answering which message.
//   3. Confirm: the send must still match the review (no newer customer message, same text,
//      same recipient), carries an idempotency key, and is logged as a send intent before
//      anything goes out. A retry never sends twice; an outcome nobody can confirm blocks new
//      replies until a person checks and settles it.

import { createHash, randomBytes } from "node:crypto";
import { transaction } from "./db";
import { audit, type StaffUser } from "./auth";
import { captureLesson } from "./learning";
import { EmailNotSentError, sendEmail } from "./aws-email";
import {
  addSimMessage,
  claimEmailReply,
  completeEmailReply,
  emailThread,
  failEmailReply,
  getDb,
  getSimTicketDetail,
  nowSql,
  pendingSend,
} from "./sim-db";

export { pendingSend };

export const GRANT_MINUTES = 30;
const REVIEW_MINUTES = 10;

type Row = Record<string, unknown>;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const sqlIn = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19).replace("T", " ");
const iso = (v: unknown) => (v == null ? null : `${String(v).replace(" ", "T")}Z`);
export const contentHash = (body: string) => sha(body.trim());

// ---------- Read & write grant ----------

export function grantSendAccess(sessionToken: string, userId: number) {
  const expires = sqlIn(GRANT_MINUTES);
  getDb()
    .prepare(
      `INSERT INTO send_grants (session_hash, user_id, expires_at) VALUES (?, ?, ?)
       ON CONFLICT (session_hash) DO UPDATE SET user_id = excluded.user_id, expires_at = excluded.expires_at, created_at = datetime('now')`,
    )
    .run(sha(sessionToken), userId, expires);
  getDb().prepare(`DELETE FROM send_grants WHERE expires_at < datetime('now')`).run();
  return iso(expires)!;
}

export function revokeSendAccess(sessionToken: string) {
  getDb().prepare(`DELETE FROM send_grants WHERE session_hash = ?`).run(sha(sessionToken));
}

/** When the grant for this session ends, or null when sending is off */
export function sendAccess(sessionToken: string | null, userId: number) {
  if (!sessionToken) return null;
  const r = getDb()
    .prepare(`SELECT expires_at FROM send_grants WHERE session_hash = ? AND user_id = ? AND expires_at > datetime('now')`)
    .get(sha(sessionToken), userId) as Row | undefined;
  return r ? iso(r.expires_at) : null;
}

// ---------- what is being answered, and to whom ----------

function target(ticketId: string) {
  const detail = getSimTicketDetail(ticketId);
  if (!detail) return null;
  const latest = [...(detail.messages ?? [])].reverse().find((m) => m.author === "customer") ?? null;
  const email = detail.ticket.channel === "email";
  const thread = email ? emailThread(ticketId) : null;
  if (email && !thread) return { error: "This email ticket has no valid customer address" } as const;
  const recipient = email
    ? thread!.to
    : `${detail.customer?.email ?? detail.ticket.customerEmail ?? "simulated customer"} (simulated)`;
  return { detail, latest, channel: email ? ("email" as const) : ("simulator" as const), recipient, thread } as const;
}

export type SendFailure = { status: number; code: string; error: string };

// ---------- review ----------

export function createReview(ticketId: string, user: StaffUser, body: string): SendFailure | {
  reviewToken: string;
  channel: "email" | "simulator";
  recipient: string;
  subject: string | null;
  answering: { id: number; excerpt: string; at: string } | null;
  expiresAt: string;
} {
  const text = body.trim();
  if (!text) return { status: 400, code: "empty", error: "Write a reply first" };
  if (text.length > 10_000) return { status: 400, code: "too_long", error: "The reply is too long (10,000 characters max)" };
  const t = target(ticketId);
  if (!t) return { status: 404, code: "not_found", error: "Ticket not found" };
  if ("error" in t) return { status: 409, code: "no_recipient", error: t.error! };
  if (t.detail.ticket.trashed || t.detail.ticket.spam) return { status: 409, code: "trashed", error: "Restore the ticket from trash or spam first" };
  const pending = pendingSend(ticketId);
  if (pending) return { status: 409, code: "pending_send", error: "An earlier reply on this ticket hasn't been confirmed yet. Check its status first." };
  const token = randomBytes(24).toString("base64url");
  const expires = sqlIn(REVIEW_MINUTES);
  getDb()
    .prepare(
      `INSERT INTO send_reviews (token_hash, ticket_id, user_id, content_hash, recipient, source_message_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sha(token), ticketId, user.id, contentHash(text), t.recipient, t.latest?.id ?? null, expires);
  getDb().prepare(`DELETE FROM send_reviews WHERE expires_at < datetime('now', '-1 day')`).run();
  return {
    reviewToken: token,
    channel: t.channel,
    recipient: t.recipient,
    subject: t.thread ? (/^re:/i.test(t.thread.subject) ? t.thread.subject : `Re: ${t.thread.subject}`) : (t.detail.ticket.subject ?? null),
    answering: t.latest ? { id: t.latest.id, excerpt: t.latest.body.slice(0, 600), at: t.latest.createdAt } : null,
    expiresAt: iso(expires)!,
  };
}

// ---------- confirm & send ----------

export async function confirmSend(input: {
  ticketId: string;
  user: StaffUser;
  sessionToken: string | null;
  body: string;
  reviewToken: string;
  idempotencyKey: string;
}): Promise<SendFailure | { status: 200 | 201; detail: ReturnType<typeof getSimTicketDetail>; channel: string }> {
  const text = input.body.trim();
  const key = input.idempotencyKey;
  if (!/^[\w-]{16,100}$/.test(key)) return { status: 400, code: "bad_key", error: "idempotencyKey is required" };
  if (!sendAccess(input.sessionToken, input.user.id)) {
    return { status: 403, code: "read_only", error: "Sending is off. Turn on Read & write to send replies." };
  }

  const d = getDb();
  // An earlier attempt with this key: answer from the log, never send again
  const existing = d.prepare(`SELECT * FROM sim_email_outbox WHERE idem_key = ?`).get(key) as Row | undefined;
  if (existing && existing.ticket_id === input.ticketId && existing.body === text && existing.status === "sent") {
    return { status: 200, detail: getSimTicketDetail(input.ticketId, input.user.id), channel: String(existing.channel) };
  }

  const review = d.prepare(`SELECT * FROM send_reviews WHERE token_hash = ?`).get(sha(input.reviewToken || "")) as Row | undefined;
  if (!review || review.ticket_id !== input.ticketId || Number(review.user_id) !== input.user.id) {
    return { status: 409, code: "no_review", error: "Review the reply before sending it" };
  }
  if (String(review.expires_at) < nowSql() && !existing) return { status: 409, code: "review_expired", error: "The review expired. Review the reply again." };
  if (review.content_hash !== contentHash(text)) return { status: 409, code: "changed_reply", error: "The reply changed after you reviewed it. Review it again." };
  const t = target(input.ticketId);
  if (!t) return { status: 404, code: "not_found", error: "Ticket not found" };
  if ("error" in t) return { status: 409, code: "no_recipient", error: t.error! };
  if (t.recipient !== review.recipient) return { status: 409, code: "changed_recipient", error: "The recipient changed after you reviewed it. Review it again." };
  if ((t.latest?.id ?? null) !== (review.source_message_id == null ? null : Number(review.source_message_id))) {
    return { status: 409, code: "newer_message", error: "The customer wrote again after you reviewed this. Read their new message first." };
  }
  const pending = pendingSend(input.ticketId);
  if (pending && pending.key !== key) {
    return { status: 409, code: "pending_send", error: "An earlier reply on this ticket hasn't been confirmed yet. Check its status first." };
  }

  const claim = claimEmailReply(key, input.ticketId, text, {
    channel: t.channel,
    recipient: t.recipient,
    sourceMessageId: t.latest?.id ?? null,
    actor: input.user.username,
  });
  if (claim.state === "sent") return { status: 200, detail: getSimTicketDetail(input.ticketId, input.user.id), channel: t.channel };
  if (claim.state === "conflict") return { status: 422, code: "key_reused", error: "This idempotency key was used for a different reply" };
  if (claim.state === "unknown") {
    return { status: 409, code: "pending_send", error: "This reply is still sending, or may already have gone out. Check its status before sending again." };
  }
  d.prepare(`UPDATE send_reviews SET used_at = datetime('now') WHERE token_hash = ?`).run(sha(input.reviewToken));

  if (t.channel === "simulator") {
    // No external system: record the message and the intent together
    const detail = transaction(d, () => {
      d.prepare(`UPDATE sim_email_outbox SET status = 'sent', updated_at = datetime('now') WHERE idem_key = ?`).run(key);
      return addSimMessage(input.ticketId, "agent", text, input.user.displayName);
    });
    audit(input.user.username, "reply", input.ticketId, { channel: "simulated", key });
    captureLesson({ ticketId: input.ticketId, sendKey: key, finalText: text, actor: input.user.username });
    return { status: 201, detail: getSimTicketDetail(input.ticketId, input.user.id) ?? detail, channel: t.channel };
  }

  let messageId: string;
  if (claim.state === "unsaved") {
    messageId = claim.messageId; // emailed on an earlier attempt but not saved: save it now
  } else {
    try {
      messageId = await sendEmail({
        to: t.thread!.to,
        subject: /^re:/i.test(t.thread!.subject) ? t.thread!.subject : `Re: ${t.thread!.subject}`,
        text,
        inReplyTo: t.thread!.messageIds.at(-1),
        references: t.thread!.messageIds,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Send failed";
      // Only a definite rejection frees the key for a resend; otherwise the email may have gone out
      if (err instanceof EmailNotSentError) {
        failEmailReply(key, message);
        return { status: 502, code: "not_sent", error: `Not sent: ${message}` };
      }
      return { status: 502, code: "uncertain", error: "The email service didn't confirm the send. It may have gone out: check the status before trying again." };
    }
  }
  try {
    completeEmailReply(key, input.ticketId, messageId, text, input.user.displayName);
    audit(input.user.username, "reply", input.ticketId, { channel: "email", messageId, key });
    captureLesson({ ticketId: input.ticketId, sendKey: key, finalText: text, actor: input.user.username });
    return { status: 201, detail: getSimTicketDetail(input.ticketId, input.user.id), channel: t.channel };
  } catch (err) {
    console.error(`send ${key} on ${input.ticketId}: emailed as ${messageId} but not saved`, err);
    return { status: 500, code: "sent_not_saved", error: "The email was sent but couldn't be saved. Send again to save it: it won't be emailed twice." };
  }
}

// ---------- uncertain sends ----------

/** A person settles a send whose outcome is unknown: "sent" records it, "not_sent" allows a resend */
export function resolvePendingSend(ticketId: string, key: string, outcome: "sent" | "not_sent", user: StaffUser) {
  const d = getDb();
  return transaction(d, () => {
    const r = d.prepare(`SELECT * FROM sim_email_outbox WHERE idem_key = ? AND ticket_id = ? AND status = 'sending'`).get(key, ticketId) as Row | undefined;
    if (!r) return { error: "Nothing to settle: the send is already resolved" };
    if (outcome === "sent") {
      d.prepare(`UPDATE sim_email_outbox SET status = 'sent', resolved_by = ?, updated_at = datetime('now') WHERE idem_key = ?`).run(user.username, key);
      // Record it in the thread so the conversation matches what the customer got
      addSimMessage(ticketId, "agent", String(r.body), String(r.actor ?? user.displayName));
      captureLesson({ ticketId, sendKey: key, finalText: String(r.body), actor: user.username });
    } else {
      d.prepare(
        `UPDATE sim_email_outbox SET status = 'failed', error = 'Marked not sent by staff', resolved_by = ?, updated_at = datetime('now') WHERE idem_key = ?`,
      ).run(user.username, key);
    }
    audit(user.username, "send_resolved", ticketId, { key, outcome });
    return { ok: true };
  });
}
