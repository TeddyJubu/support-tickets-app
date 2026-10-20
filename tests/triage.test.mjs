// Inbox triage: views, counts, filters, single and bulk changes, read state, notes,
// staff-created tickets and email attachments.

import { scratch, importApp, call, staffSession } from "./helpers.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const simDb = await importApp("lib/sim-db.ts");
const list = await importApp("app/api/helpdesk/tickets/route.ts");
const one = await importApp("app/api/helpdesk/sim/tickets/[id]/route.ts");
const bulk = await importApp("app/api/helpdesk/sim/tickets/bulk/route.ts");
const messages = await importApp("app/api/helpdesk/sim/tickets/[id]/messages/route.ts");
const attachmentRoute = await importApp("app/api/helpdesk/attachments/[id]/route.ts");
const { saveAttachment } = await importApp("lib/attachments.ts");
const raw = new DatabaseSync(join(scratch, "sim.db"));

const alice = await staffSession({ displayName: "Alice" });
const bob = await staffSession({ displayName: "Bob" });

let n = 0;
const ticket = (extra = {}) =>
  simDb.createSimTicket({
    customer: { sourceKey: `k${++n}`, firstName: "Cus", lastName: `Tomer${n}`, email: `c${n}@customers.bb-sim.test` },
    subject: `Question ${n}`,
    body: "Hello?",
    ...extra,
  });

const listAs = async (who, params = {}) =>
  (await call(list.GET, { url: `http://t/api/helpdesk/tickets?source=sim&${new URLSearchParams(params)}`, headers: { cookie: who.cookie } })).json;
const patch = (who, id, body) => call(one.PATCH, { method: "PATCH", body, params: { id }, headers: { cookie: who.cookie } });

const a = ticket({ tags: "Return, damaged" });
const b = ticket({ priority: "high" });
const c = ticket();

test("source tags become ticket tags; channel defaults to simulator", () => {
  const d = simDb.getSimTicketDetail(a);
  assert.deepEqual(d.ticket.tagList, ["damaged", "return"]);
  assert.equal(d.ticket.channel, "simulator");
});

test("new customer messages are unread until opened", async () => {
  let r = await listAs(alice, { view: "all" });
  assert.ok(r.tickets.find((t) => t.id === a).unread);
  assert.equal((await patch(alice, a, { read: true })).status, 200);
  r = await listAs(alice, { view: "all" });
  assert.equal(r.tickets.find((t) => t.id === a).unread, false);
  // Read state is per person
  assert.ok((await listAs(bob, { view: "all" })).tickets.find((t) => t.id === a).unread);
});

test("assign, 'mine' and 'unassigned' views, with counts", async () => {
  assert.equal((await patch(alice, a, { assigneeId: alice.user.id })).status, 200);
  const r = await listAs(alice, { view: "mine" });
  assert.deepEqual(r.tickets.map((t) => t.id), [a]);
  assert.equal(r.counts.mine, 1);
  assert.equal(r.counts.unassigned, 2);
  assert.equal((await listAs(bob, { view: "mine" })).total, 0);
  assert.equal(r.tickets[0].assignee.displayName, "Alice");
});

test("snoozed tickets leave the active views and come back when the customer writes", async () => {
  const until = new Date(Date.now() + 3600e3).toISOString();
  assert.equal((await patch(alice, c, { snoozedUntil: until })).status, 200);
  let r = await listAs(alice, { view: "all" });
  assert.ok(!r.tickets.some((t) => t.id === c));
  assert.equal(r.counts.snoozed, 1);
  simDb.addSimMessage(c, "customer", "Any news?");
  r = await listAs(alice, { view: "all" });
  assert.ok(r.tickets.some((t) => t.id === c));
  assert.equal(r.counts.snoozed, 0);
});

test("snooze must be in the future and within 90 days", async () => {
  assert.equal((await patch(alice, c, { snoozedUntil: new Date(Date.now() - 1000).toISOString() })).status, 400);
  assert.equal((await patch(alice, c, { snoozedUntil: new Date(Date.now() + 100 * 86400e3).toISOString() })).status, 400);
});

test("filters: priority, tag, assignee=none, channel; sort", async () => {
  assert.deepEqual((await listAs(alice, { priority: "high" })).tickets.map((t) => t.id), [b]);
  assert.deepEqual((await listAs(alice, { tag: "return" })).tickets.map((t) => t.id), [a]);
  assert.ok(!(await listAs(alice, { assignee: "none" })).tickets.some((t) => t.id === a));
  assert.equal((await listAs(alice, { channel: "email" })).total, 0);
  const newest = (await listAs(alice, {})).tickets.map((t) => t.id);
  const oldest = (await listAs(alice, { sort: "oldest" })).tickets.map((t) => t.id);
  assert.deepEqual(oldest, [...newest].reverse());
});

test("tags: add, remove, replace", async () => {
  await patch(alice, b, { addTag: "VIP Customer" });
  assert.deepEqual(simDb.getSimTicketDetail(b).ticket.tagList, ["vip-customer"]);
  await patch(alice, b, { removeTag: "vip-customer" });
  assert.deepEqual(simDb.getSimTicketDetail(b).ticket.tagList, []);
  await patch(alice, b, { tags: ["x", "y", "x"] });
  assert.deepEqual(simDb.getSimTicketDetail(b).ticket.tagList, ["x", "y"]);
});

test("trash and spam have their own views and restore", async () => {
  await patch(alice, b, { trashed: true });
  let r = await listAs(alice, { view: "trash" });
  assert.deepEqual(r.tickets.map((t) => t.id), [b]);
  assert.ok(!(await listAs(alice, { view: "all" })).tickets.some((t) => t.id === b));
  await patch(alice, b, { trashed: false, spam: true });
  r = await listAs(alice, { view: "spam" });
  assert.deepEqual(r.tickets.map((t) => t.id), [b]);
  await patch(alice, b, { spam: false });
  assert.equal((await listAs(alice, { view: "spam" })).total, 0);
});

test("invalid changes are refused and nothing is written", async () => {
  for (const body of [{ priority: "urgent" }, { status: "done" }, { assigneeId: 999 }, { evil: 1 }, {}, { subject: "" }]) {
    assert.equal((await patch(alice, a, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await patch(alice, "SIM-9", { priority: "low" })).status, 404);
});

test("rename subject and close, all audited", async () => {
  await patch(alice, a, { subject: "Return for a damaged dress", status: "closed" });
  const d = simDb.getSimTicketDetail(a);
  assert.equal(d.ticket.subject, "Return for a damaged dress");
  assert.ok(d.ticket.closedAt);
  const log = raw.prepare(`SELECT actor, action, detail FROM audit_log WHERE ticket_id = ? AND action = 'triage'`).all(a);
  assert.ok(log.some((l) => l.actor === alice.user.username && JSON.parse(l.detail).subject));
});

test("bulk changes apply to all tickets at once and skip unknown ids", async () => {
  const r = await call(bulk.POST, {
    method: "POST",
    headers: { cookie: bob.cookie },
    body: { ids: [a, b, c, "SIM-424242"], changes: { priority: "low", assigneeId: bob.user.id } },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.updated.sort(), [a, b, c].sort());
  for (const id of [a, b, c]) {
    const t = simDb.getSimTicketDetail(id).ticket;
    assert.equal(t.priority, "low");
    assert.equal(t.assignee.id, bob.user.id);
  }
  const bad = await call(bulk.POST, { method: "POST", headers: { cookie: bob.cookie }, body: { ids: [a], changes: { priority: "nope" } } });
  assert.equal(bad.status, 400);
  assert.equal((await call(bulk.POST, { method: "POST", body: { ids: [a], changes: { priority: "low" } } })).status, 401);
});

test("internal notes are signed, don't count as replies and don't change status", async () => {
  const id = ticket();
  const r = await call(messages.POST, { method: "POST", params: { id }, headers: { cookie: alice.cookie }, body: { author: "note", body: "Called the warehouse", sender: "Forged" } });
  assert.equal(r.status, 201);
  const d = simDb.getSimTicketDetail(id);
  const note = d.messages.at(-1);
  assert.equal(note.author, "note");
  assert.equal(note.sender, "Alice");
  assert.equal(d.ticket.status, "open");
  assert.equal(d.ticket.agentMessages, 0);
});

test("simulator follow-ups never include email tickets", () => {
  const email = ticket({ tags: "email", channel: "email" });
  simDb.addSimMessage(email, "agent", "Reply", "Alice");
  const sim = ticket();
  simDb.addSimMessage(sim, "agent", "Reply", "Alice");
  const ids = simDb.ticketsAwaitingCustomer(50).map((d) => d.ticket.id);
  assert.ok(ids.includes(sim));
  assert.ok(!ids.includes(email));
});

test("staff can open an email ticket for a customer", async () => {
  const r = await call(list.POST, {
    method: "POST",
    headers: { cookie: alice.cookie },
    body: { email: "Someone@Example.com", name: "Some One", subject: "Your order", note: "Customer called" },
  });
  assert.equal(r.status, 201);
  const t = r.json.ticket;
  assert.equal(t.channel, "email");
  assert.equal(t.assignee.id, alice.user.id);
  assert.equal(r.json.messages[0].author, "note");
  assert.equal(simDb.emailThread(t.id).to, "someone@example.com");
  assert.equal((await call(list.POST, { method: "POST", headers: { cookie: alice.cookie }, body: { email: "bad", subject: "x" } })).status, 400);
});

test("attachments: stored content-addressed, executables refused, served to staff only", async () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const img = saveAttachment(png, "photo.png", "image/png");
  const again = saveAttachment(png, "photo-copy.png", "image/png");
  assert.equal(img.sha256, again.sha256);
  const exe = saveAttachment(Buffer.from("MZ"), "setup.exe", "application/octet-stream");
  const svg = saveAttachment(Buffer.from("<svg onload=alert(1)>"), "x.svg", "image/svg+xml");
  assert.equal(exe.stored, false);
  assert.equal(svg.stored, false);

  const id = ticket();
  simDb.appendMessage(id, "customer", "See photo", "Cus", { attachments: [img, exe] });
  const atts = simDb.getSimTicketDetail(id).messages.at(-1).attachments;
  assert.equal(atts.length, 2);

  const ok = await call(attachmentRoute.GET, { params: { id: String(atts[0].id) }, headers: { cookie: alice.cookie } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await call(attachmentRoute.GET, { params: { id: String(atts[0].id) } })).status, 401);
  assert.equal((await call(attachmentRoute.GET, { params: { id: String(atts[1].id) }, headers: { cookie: alice.cookie } })).status, 404);
});
