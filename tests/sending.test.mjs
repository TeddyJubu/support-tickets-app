// Safe sending: Read & write grants, review-then-confirm, stale-review rejection,
// idempotent email sends (a retry never emails twice) and unconfirmed sends.
// SES is stubbed (no email is ever sent) and the database is a scratch one.

import { scratch, stubModule, importApp, call, staffSession } from "./helpers.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

// Fake SES, controlled per test through globalThis.__ses
stubModule(
  "./aws-email",
  `export class EmailNotSentError extends Error {}
   export async function sendEmail(m) {
     const ses = globalThis.__ses;
     ses.calls.push(m);
     return ses.impl(m, EmailNotSentError);
   }
   export async function getInboundEmail() { return null; }`,
);

let sent = 0;
const ses = { calls: [], impl: async () => `<fake-${++sent}-${Date.now()}@us-west-2.amazonses.com>` };
globalThis.__ses = ses;
const ok = ses.impl;
const reset = () => {
  ses.calls.length = 0;
  ses.impl = ok;
};

const simDb = await importApp("lib/sim-db.ts");
const accessRoute = await importApp("app/api/helpdesk/send-access/route.ts");
const reviewRoute = await importApp("app/api/helpdesk/tickets/[id]/send/review/route.ts");
const sendRoute = await importApp("app/api/helpdesk/tickets/[id]/send/route.ts");
const resolveRoute = await importApp("app/api/helpdesk/tickets/[id]/send/resolve/route.ts");
const messagesRoute = await importApp("app/api/helpdesk/sim/tickets/[id]/messages/route.ts");
const raw = new DatabaseSync(join(scratch, "sim.db"));

const staff = await staffSession({ displayName: "Dana Agent" });
const other = await staffSession({ displayName: "Omar" });
const as = (s) => ({ cookie: s.cookie });

let n = 0;
const emailTicket = () =>
  simDb.ingestEmail({
    customer: { sourceKey: `email:test-${++n}`, firstName: "Reply", lastName: "Test", email: `reply-${n}@customers.bb-sim.test` },
    subject: "Where is my order?",
    body: "Where is my order?",
    tags: "email",
    messageId: `<inbound-${n}-${Date.now()}@customers.bb-sim.test>`,
    refs: [],
  }).ticketId;
const simTicket = () =>
  simDb.createSimTicket({
    customer: { sourceKey: `sim-${++n}`, firstName: "Sim", lastName: "Customer", email: `sim-${n}@customers.bb-sim.test` },
    subject: "Sizing",
    body: "Does it run small?",
  });

const agentMessages = (id) => raw.prepare(`SELECT count(*) AS c FROM sim_messages WHERE ticket_id = ? AND author = 'agent'`).get(id).c;
const outbox = (key) => raw.prepare(`SELECT * FROM sim_email_outbox WHERE idem_key = ?`).get(key);
const key = (k) => `test-key-${k}-${Date.now()}-0000`;

const enable = (s = staff) => call(accessRoute.POST, { method: "POST", headers: as(s), body: { enable: true } });
const reviewFor = (id, body, s = staff) => call(reviewRoute.POST, { method: "POST", params: { id }, headers: as(s), body: { body } });
const send = (id, body, reviewToken, idempotencyKey, s = staff) =>
  call(sendRoute.POST, { method: "POST", params: { id }, headers: as(s), body: { body, reviewToken, idempotencyKey } });
async function reviewAndSend(id, body, k, s = staff) {
  const r = await reviewFor(id, body, s);
  assert.equal(r.status, 200, r.text);
  return { review: r.json, res: await send(id, body, r.json.reviewToken, k, s) };
}

test("sending is off until Read & write is turned on, per session", async () => {
  reset();
  const id = emailTicket();
  const r = await reviewFor(id, "Hello");
  const res = await send(id, "Hello", r.json.reviewToken, key("ro"));
  assert.equal(res.status, 403);
  assert.equal(res.json.code, "read_only");
  assert.equal(ses.calls.length, 0);
  const on = await enable();
  assert.ok(Date.parse(on.json.expiresAt) > Date.now() + 29 * 60_000);
  // The grant is stored as a hash of the session, never the token itself
  assert.equal(raw.prepare(`SELECT count(*) AS c FROM send_grants WHERE session_hash = ?`).get(staff.token).c, 0);
  // Another person's session isn't covered
  const theirs = await reviewFor(id, "Hello", other);
  assert.equal((await send(id, "Hello", theirs.json.reviewToken, key("other"), other)).json.code, "read_only");
});

test("review shows recipient, subject and the message being answered", async () => {
  await enable();
  const id = emailTicket();
  const r = await reviewFor(id, "Your order shipped today.");
  assert.equal(r.status, 200);
  assert.match(r.json.recipient, /@customers\.bb-sim\.test$/);
  assert.equal(r.json.subject, "Re: Where is my order?");
  assert.equal(r.json.answering.excerpt, "Where is my order?");
  assert.equal(r.json.channel, "email");
});

test("a confirmed email reply is sent once, saved, signed and audited", async () => {
  reset();
  await enable();
  const id = emailTicket();
  const k = key(1);
  const { res } = await reviewAndSend(id, "Your order shipped today.", k);
  assert.equal(res.status, 201, res.text);
  assert.equal(ses.calls.length, 1);
  assert.equal(res.json.messages.at(-1).sender, "Dana Agent");
  assert.equal(outbox(k).status, "sent");
  assert.equal(outbox(k).actor, staff.user.username);
  // Retry with the same key: answered from the log
  const again = await send(id, "Your order shipped today.", "anything", k);
  assert.equal(again.status, 200);
  assert.equal(ses.calls.length, 1);
  assert.equal(agentMessages(id), 1);
});

test("the send must match the review: text, recipient, newer customer message, owner", async () => {
  reset();
  await enable();
  const id = emailTicket();
  const r = (await reviewFor(id, "Version A")).json;
  assert.equal((await send(id, "Version B", r.reviewToken, key("a"))).json.code, "changed_reply");
  await enable(other);
  // Someone else's review can't be used
  assert.equal((await send(id, "Version A", r.reviewToken, key("b"), other)).json.code, "no_review");
  simDb.addSimMessage(id, "customer", "Also, can I change the size?", "Reply Test");
  assert.equal((await send(id, "Version A", r.reviewToken, key("c"))).json.code, "newer_message");
  const r2 = (await reviewFor(id, "Version A")).json;
  raw.prepare(`UPDATE sim_customers SET email = 'changed@customers.bb-sim.test' WHERE id = (SELECT customer_id FROM sim_tickets WHERE id = ?)`).run(id);
  assert.equal((await send(id, "Version A", r2.reviewToken, key("d"))).json.code, "changed_recipient");
  raw.prepare(`UPDATE send_reviews SET expires_at = datetime('now', '-1 minute')`).run();
  const r3 = (await reviewFor(id, "Version A")).json;
  raw.prepare(`UPDATE send_reviews SET expires_at = datetime('now', '-1 minute') WHERE ticket_id = ?`).run(id);
  assert.equal((await send(id, "Version A", r3.reviewToken, key("e"))).json.code, "review_expired");
  assert.equal(ses.calls.length, 0);
});

test("a DB failure after the send is saved on retry without emailing again", async () => {
  reset();
  await enable();
  const id = emailTicket();
  const k = key(2);
  const r = (await reviewFor(id, "Refund is on its way.")).json;
  raw.exec(`CREATE TRIGGER fail_agent_insert BEFORE INSERT ON sim_messages WHEN NEW.author = 'agent' BEGIN SELECT RAISE(ABORT, 'disk on fire'); END`);
  const first = await send(id, "Refund is on its way.", r.reviewToken, k);
  raw.exec(`DROP TRIGGER fail_agent_insert`);
  assert.equal(first.status, 500);
  assert.equal(first.json.code, "sent_not_saved");
  assert.equal(ses.calls.length, 1);
  assert.ok(outbox(k).message_id, "Message-ID kept for the retry");
  const retry = await send(id, "Refund is on its way.", r.reviewToken, k);
  assert.equal(retry.status, 201, retry.text);
  assert.equal(ses.calls.length, 1, "retry did not email again");
  assert.equal(agentMessages(id), 1);
});

test("a definite SES rejection can be confirmed again and sent", async () => {
  reset();
  await enable();
  const id = emailTicket();
  const k = key(4);
  ses.impl = async (_m, NotSent) => {
    throw new NotSent("Email address is not verified");
  };
  const r = (await reviewFor(id, "Try this link.")).json;
  const first = await send(id, "Try this link.", r.reviewToken, k);
  assert.equal(first.json.code, "not_sent");
  ses.impl = ok;
  const retry = await send(id, "Try this link.", r.reviewToken, k);
  assert.equal(retry.status, 201, retry.text);
  assert.equal(ses.calls.length, 2);
});

test("an ambiguous error blocks new replies until a person settles it", async () => {
  reset();
  await enable();
  const id = emailTicket();
  const k = key(5);
  ses.impl = async () => {
    throw new Error("fetch failed");
  };
  const r = (await reviewFor(id, "Label attached.")).json;
  assert.equal((await send(id, "Label attached.", r.reviewToken, k)).json.code, "uncertain");
  ses.impl = ok;
  // Same key: still refuses to send
  assert.equal((await send(id, "Label attached.", r.reviewToken, k)).json.code, "pending_send");
  // A different reply can't even be reviewed
  assert.equal((await reviewFor(id, "Something else")).json.code, "pending_send");
  assert.equal(ses.calls.length, 1);
  const detail = simDb.getSimTicketDetail(id);
  assert.equal(detail.pendingSend.key, k);

  // "It didn't go out": sending is allowed again
  const settled = await call(resolveRoute.POST, { method: "POST", params: { id }, headers: as(staff), body: { key: k, outcome: "not_sent" } });
  assert.equal(settled.status, 200);
  assert.equal(settled.json.pendingSend, null);
  const { res } = await reviewAndSend(id, "Label attached.", key(6));
  assert.equal(res.status, 201);
});

test("'It went out' records the reply in the thread", async () => {
  reset();
  await enable();
  const id = emailTicket();
  const k = key(7);
  ses.impl = async () => {
    throw new Error("socket hang up");
  };
  const r = (await reviewFor(id, "Your exchange is approved.")).json;
  await send(id, "Your exchange is approved.", r.reviewToken, k);
  ses.impl = ok;
  const settled = await call(resolveRoute.POST, { method: "POST", params: { id }, headers: as(staff), body: { key: k, outcome: "sent" } });
  assert.equal(settled.json.messages.at(-1).body, "Your exchange is approved.");
  assert.equal(outbox(k).status, "sent");
  assert.equal(outbox(k).resolved_by, staff.user.username);
});

test("two concurrent confirms with one key send once", async () => {
  reset();
  await enable();
  const id = emailTicket();
  const k = key(8);
  ses.impl = async (m) => {
    await new Promise((res) => setTimeout(res, 50));
    return ok(m);
  };
  const r = (await reviewFor(id, "Double click.")).json;
  const results = await Promise.all([send(id, "Double click.", r.reviewToken, k), send(id, "Double click.", r.reviewToken, k)]);
  assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
  assert.equal(ses.calls.length, 1);
  assert.equal(agentMessages(id), 1);
});

test("simulated tickets use the same review and idempotency, without email", async () => {
  reset();
  await enable();
  const id = simTicket();
  const k = key(9);
  const { review, res } = await reviewAndSend(id, "It runs true to size.", k);
  assert.equal(review.channel, "simulator");
  assert.equal(res.status, 201, res.text);
  assert.equal(ses.calls.length, 0);
  assert.equal(res.json.ticket.status, "pending");
  assert.equal((await send(id, "It runs true to size.", review.reviewToken, k)).status, 200);
  assert.equal(agentMessages(id), 1);
});

test("staff can't bypass review through the messages route", async () => {
  const id = simTicket();
  const r = await call(messagesRoute.POST, { method: "POST", params: { id }, headers: as(staff), body: { author: "agent", body: "sneaky" } });
  assert.equal(r.status, 409);
  // The server CLI (bearer key) may still post a simulated reply, but never on an email ticket:
  // for the key, only simulated tickets exist
  const cli = { authorization: `Bearer ${process.env.SIM_API_KEY}` };
  assert.equal((await call(messagesRoute.POST, { method: "POST", params: { id }, headers: cli, body: { author: "agent", body: "from cli" } })).status, 201);
  const email = emailTicket();
  assert.equal((await call(messagesRoute.POST, { method: "POST", params: { id: email }, headers: cli, body: { author: "agent", body: "x" } })).status, 404);
});

test("a review can be used for one send only", async () => {
  reset();
  await enable();
  const id = simTicket();
  const r = (await reviewFor(id, "One review, one send.")).json;
  assert.equal((await send(id, "One review, one send.", r.reviewToken, key(20))).status, 201);
  const again = await send(id, "One review, one send.", r.reviewToken, key(21));
  assert.equal(again.status, 409);
  assert.equal(again.json.code, "no_review");
  assert.equal(agentMessages(id), 1);
});

test("a simulated send that fails to save frees the send for a retry", async () => {
  reset();
  await enable();
  const id = simTicket();
  const k = key(22);
  const r = (await reviewFor(id, "Saved on retry.")).json;
  raw.exec(`CREATE TRIGGER fail_sim_agent BEFORE INSERT ON sim_messages WHEN NEW.author = 'agent' BEGIN SELECT RAISE(ABORT, 'locked'); END`);
  const first = await send(id, "Saved on retry.", r.reviewToken, k);
  raw.exec(`DROP TRIGGER fail_sim_agent`);
  assert.equal(first.json.code, "not_sent");
  assert.equal(simDb.getSimTicketDetail(id).pendingSend, null, "ticket not blocked");
  assert.equal((await send(id, "Saved on retry.", r.reviewToken, k)).status, 201);
  assert.equal(agentMessages(id), 1);
});

test("two people answering the same message: only the first confirm emails the customer", async () => {
  reset();
  await enable();
  await enable(other);
  const id = emailTicket();
  const mine = (await reviewFor(id, "It ships Monday.")).json;
  const theirs = (await reviewFor(id, "It ships Monday!", other)).json;
  assert.equal((await send(id, "It ships Monday.", mine.reviewToken, key("first"))).status, 201);
  const late = await send(id, "It ships Monday!", theirs.reviewToken, key("second"), other);
  assert.equal(late.status, 409);
  assert.equal(late.json.code, "already_answered");
  assert.equal(ses.calls.length, 1, "the customer got one email");
  assert.equal(agentMessages(id), 1);
  // A follow-up reviewed after that reply still goes out
  const { res } = await reviewAndSend(id, "One more thing: tracking is attached.", key("follow-up"));
  assert.equal(res.status, 201, res.text);
  assert.equal(ses.calls.length, 2);
});

test("a subject renamed after the review cancels it", async () => {
  reset();
  await enable();
  const id = emailTicket();
  const r = (await reviewFor(id, "Here's your tracking link.")).json;
  assert.equal(r.subject, "Re: Where is my order?");
  raw.prepare(`UPDATE sim_tickets SET subject = 'Internal: VIP' WHERE id = ?`).run(id);
  const res = await send(id, "Here's your tracking link.", r.reviewToken, key("renamed"));
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "changed_subject");
  assert.equal(ses.calls.length, 0);
});

test("a reply the email service accepted can't be marked 'didn't go out'", async () => {
  reset();
  await enable();
  const id = emailTicket();
  const k = key("accepted");
  const r = (await reviewFor(id, "Your refund is approved.")).json;
  raw.exec(`CREATE TRIGGER fail_agent_insert2 BEFORE INSERT ON sim_messages WHEN NEW.author = 'agent' BEGIN SELECT RAISE(ABORT, 'disk on fire'); END`);
  assert.equal((await send(id, "Your refund is approved.", r.reviewToken, k)).json.code, "sent_not_saved");
  raw.exec(`DROP TRIGGER fail_agent_insert2`);
  const pending = simDb.getSimTicketDetail(id).pendingSend;
  assert.equal(pending.hasMessageId, true);

  const notSent = await call(resolveRoute.POST, { method: "POST", params: { id }, headers: as(staff), body: { key: k, outcome: "not_sent" } });
  assert.equal(notSent.status, 409);
  assert.equal(outbox(k).status, "sending", "still blocks new replies");
  assert.equal((await reviewFor(id, "Your refund is approved.")).json.code, "pending_send");

  const sent = await call(resolveRoute.POST, { method: "POST", params: { id }, headers: as(staff), body: { key: k, outcome: "sent" } });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.messages.at(-1).body, "Your refund is approved.");
  // The customer's answer to that email threads back into this ticket
  const emailed = outbox(k).message_id;
  assert.equal(raw.prepare(`SELECT ticket_id FROM sim_email_ids WHERE message_id = ?`).get(emailed)?.ticket_id, id);
  assert.equal(ses.calls.length, 1);
});
