// Tests the email reply route's idempotency against a scratch copy of data/sim.db.
// SES is stubbed: @/lib/aws-email resolves to an in-memory fake, so no email is ever sent.
//   node --no-warnings scripts/test-email-reply.mjs     (SIM_DB_SOURCE=path/to/sim.db to copy another db)

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { test, after } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));

// Scratch copy: lib/sim-db.ts opens <cwd>/data/sim.db
const scratch = mkdtempSync(join(tmpdir(), "email-reply-test-"));
mkdirSync(join(scratch, "data"));
const dbPath = join(scratch, "data/sim.db");
const live = process.env.SIM_DB_SOURCE ?? join(root, "data/sim.db");
if (existsSync(live)) new DatabaseSync(live, { readOnly: true }).exec(`VACUUM INTO '${dbPath.replaceAll("'", "''")}'`);
process.chdir(scratch);
for (const k of Object.keys(process.env)) if (/AWS|OUTBOUND_EMAIL/.test(k)) delete process.env[k];
after(() => rmSync(scratch, { recursive: true, force: true }));

// Fake SES, controlled per test through globalThis.__ses
const stub = `
  export class EmailNotSentError extends Error {}
  export async function sendEmail(m) {
    const ses = globalThis.__ses;
    ses.calls.push(m);
    return ses.impl(m, EmailNotSentError);
  }`;
const hooks = `
  const root = ${JSON.stringify(pathToFileURL(root).href)};
  const stub = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(stub)}`)};
  export async function resolve(spec, ctx, next) {
    if (spec === "@/lib/aws-email") return { url: stub, shortCircuit: true };
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), root).href;
    if (/^(\\.|file:)/.test(spec) && !/\\.[cm]?[jt]sx?$/.test(spec)) {
      try { return await next(spec + ".ts", ctx); } catch {}
    }
    return next(spec, ctx);
  }`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

let sent = 0;
const ses = { calls: [], impl: async () => `<fake-${++sent}-${Date.now()}@us-west-2.amazonses.com>` };
globalThis.__ses = ses;
const ok = ses.impl;

const { POST } = await import(pathToFileURL(join(root, "app/api/helpdesk/email/tickets/[id]/reply/route.ts")).href);
const simDb = await import(pathToFileURL(join(root, "lib/sim-db.ts")).href);

// A simulated email ticket of our own (simulator domain), only in the scratch copy
const { ticketId } = simDb.ingestEmail({
  customer: { sourceKey: `email:test-${Date.now()}`, firstName: "Reply", lastName: "Test", email: "reply-test@customers.bb-sim.test" },
  subject: "Idempotency test",
  body: "Where is my order?",
  tags: "email",
  messageId: `<inbound-${Date.now()}@customers.bb-sim.test>`,
  refs: [],
});

const raw = new DatabaseSync(dbPath);
const agentMessages = () =>
  raw.prepare(`SELECT count(*) AS c FROM sim_messages WHERE ticket_id = ? AND author = 'agent'`).get(ticketId).c;
const outbox = (key) => raw.prepare(`SELECT * FROM sim_email_outbox WHERE idem_key = ?`).get(key);
const savedIds = () =>
  raw.prepare(`SELECT message_id FROM sim_email_ids WHERE ticket_id = ?`).all(ticketId).map((r) => r.message_id);

const reply = async (body, idempotencyKey) => {
  const res = await POST(
    new Request("http://test/reply", { method: "POST", body: JSON.stringify({ body, idempotencyKey }) }),
    { params: Promise.resolve({ id: ticketId }) },
  );
  return { status: res.status, json: await res.json() };
};
const key = (n) => `test-key-${n}-${Date.now()}-0000`;
const reset = () => {
  ses.calls.length = 0;
  ses.impl = ok;
};

test("scratch copy is in use", () => {
  assert.equal(process.cwd(), scratch);
  assert.ok(simDb.getSimTicketDetail(ticketId));
});

test("rejects a reply without an idempotency key", async () => {
  reset();
  assert.equal((await reply("hi")).status, 400);
  assert.equal(ses.calls.length, 0);
});

test("a duplicate key returns the saved reply without sending again", async () => {
  reset();
  const k = key(1);
  const before = agentMessages();
  const first = await reply("Your order shipped today.", k);
  assert.equal(first.status, 201);
  assert.equal(ses.calls.length, 1);
  assert.equal(agentMessages(), before + 1);
  assert.equal(outbox(k).status, "sent");
  assert.ok(savedIds().includes(outbox(k).message_id));

  const again = await reply("Your order shipped today.", k);
  assert.equal(again.status, 200);
  assert.equal(ses.calls.length, 1, "no second send");
  assert.equal(agentMessages(), before + 1, "no second message");
  assert.equal(again.json.ticket.id, ticketId);

  const other = await reply("Something else", k);
  assert.equal(other.status, 422);
  assert.equal(ses.calls.length, 1);
});

test("a DB failure after the send is saved on retry without sending again", async () => {
  reset();
  const k = key(2);
  const before = agentMessages();
  raw.exec(`CREATE TRIGGER fail_agent_insert BEFORE INSERT ON sim_messages BEGIN SELECT RAISE(ABORT, 'disk on fire'); END`);
  const first = await reply("Refund is on its way.", k);
  raw.exec(`DROP TRIGGER fail_agent_insert`);
  assert.equal(first.status, 500);
  assert.match(first.json.error, /sent but couldn't be saved/);
  assert.equal(ses.calls.length, 1);
  assert.equal(agentMessages(), before, "message write rolled back");
  assert.equal(outbox(k).status, "sending");
  assert.ok(outbox(k).message_id, "Message-ID kept for the retry");
  assert.ok(!savedIds().includes(outbox(k).message_id), "thread id rolled back with the message");

  const retry = await reply("Refund is on its way.", k);
  assert.equal(retry.status, 201);
  assert.equal(ses.calls.length, 1, "retry did not email again");
  assert.equal(agentMessages(), before + 1);
  assert.equal(outbox(k).status, "sent");
  assert.ok(savedIds().includes(outbox(k).message_id));

  assert.equal((await reply("Refund is on its way.", k)).status, 200);
  assert.equal(ses.calls.length, 1);
  assert.equal(agentMessages(), before + 1);
});

test("if not even the Message-ID can be saved, a retry refuses to send", async () => {
  reset();
  const k = key(3);
  const before = agentMessages();
  raw.exec(`CREATE TRIGGER fail_outbox_update BEFORE UPDATE ON sim_email_outbox BEGIN SELECT RAISE(ABORT, 'read-only'); END`);
  const first = await reply("Exchange approved.", k);
  raw.exec(`DROP TRIGGER fail_outbox_update`);
  assert.equal(first.status, 500);
  assert.equal(ses.calls.length, 1);
  assert.equal(outbox(k).message_id, null);

  const retry = await reply("Exchange approved.", k);
  assert.equal(retry.status, 409);
  assert.equal(ses.calls.length, 1, "outcome unknown: never resend");
  assert.equal(agentMessages(), before);
});

test("a definite SES rejection can be retried and sent", async () => {
  reset();
  const k = key(4);
  ses.impl = async (_m, NotSent) => {
    throw new NotSent("Email address is not verified");
  };
  const first = await reply("Try this link.", k);
  assert.equal(first.status, 502);
  assert.equal(outbox(k).status, "failed");

  ses.impl = ok;
  const retry = await reply("Try this link.", k);
  assert.equal(retry.status, 201);
  assert.equal(ses.calls.length, 2);
  assert.equal(outbox(k).status, "sent");
});

test("an ambiguous SES error (maybe sent) is never resent", async () => {
  reset();
  const k = key(5);
  ses.impl = async () => {
    throw new Error("fetch failed");
  };
  assert.equal((await reply("Label attached.", k)).status, 502);
  ses.impl = ok;
  assert.equal((await reply("Label attached.", k)).status, 409);
  assert.equal(ses.calls.length, 1);
});

test("two concurrent requests with one key send once", async () => {
  reset();
  const k = key(6);
  const before = agentMessages();
  ses.impl = async (m) => {
    await new Promise((r) => setTimeout(r, 50));
    return ok(m);
  };
  const results = await Promise.all([reply("Double click.", k), reply("Double click.", k)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(ses.calls.length, 1);
  assert.equal(agentMessages(), before + 1);
});
