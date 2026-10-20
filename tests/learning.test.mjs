// Learning loop: PII masking, lessons captured from delivered replies, owner approval,
// nightly promotion into masked KB examples.

import { importApp, call, staffSession } from "./helpers.mjs";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const { maskPii, maskWithNames } = await importApp("lib/pii.ts");
const simDb = await importApp("lib/sim-db.ts");
const learning = await importApp("lib/learning.ts");
const sending = await importApp("lib/sending.ts");
const learnRoute = await importApp("app/api/learning/route.ts");
const decideRoute = await importApp("app/api/learning/[id]/route.ts");

const owner = await staffSession({ role: "owner", displayName: "Olive" });
const agent = await staffSession({ displayName: "Andy" });

test("PII masking: emails, links, phones, cards, orders, tracking, addresses, greetings", () => {
  const raw =
    "Hi Rachel, email me at rachel.cohen@gmail.com or call 973-555-0142. Order #10312 / #S1004, tracking 1Z999AA10123456784, " +
    "card 4111 1111 1111 1111, ship to 12 Maple Street Apt 4, Newark NJ 07102. See https://example.com/x";
  const out = maskPii(raw);
  for (const leak of ["rachel.cohen", "973-555", "10312", "S1004", "1Z999", "4111", "Maple", "07102", "example.com", "Rachel"]) {
    assert.ok(!out.includes(leak), `${leak} in: ${out}`);
  }
  assert.match(out, /Hi \[name\],/);
  assert.equal(maskPii("Hi there, thanks"), "Hi there, thanks");
});

test("known names are masked in any script, longest first", () => {
  assert.equal(maskWithNames("Thanks Yael Cohen! Yael, your size is in.", ["Yael Cohen"]), "Thanks [name]! [name], your size is in.");
  assert.equal(maskWithNames("שלום נועה, תודה", ["נועה"]), "שלום [name], תודה");
});

let n = 0;
async function sendReply(text) {
  const id = simDb.createSimTicket({
    customer: { sourceKey: `learn-${++n}`, firstName: "Rachel", lastName: "Cohen", email: `rachel${n}@customers.bb-sim.test` },
    subject: "Sizing for my daughter",
    body: "Hi, I'm Rachel Cohen (rachel@gmail.com). Does the tulle dress run small? Order #S1009",
    aiIntent: "Product::Sizing",
  });
  const db = simDb.getDb();
  db.prepare(`INSERT INTO drafts (ticket_id, message_id, body, action) SELECT ?, max(id), 'Hi Rachel, it runs true to size.', 'reply' FROM sim_messages WHERE ticket_id = ?`).run(id, id);
  sending.grantSendAccess(owner.token, owner.user.id);
  const review = sending.createReview(id, owner.user, text);
  const res = await sending.confirmSend({ ticketId: id, user: owner.user, sessionToken: owner.token, body: text, reviewToken: review.reviewToken, idempotencyKey: `learn-key-${n}-0000000000` });
  assert.equal(res.status, 201);
  return id;
}

test("a delivered reply becomes a pending lesson, shown masked", async () => {
  const id = await sendReply("Hi Rachel, it runs a little small, so size up. Call us on 973-555-0142 if unsure.");
  const [lesson] = learning.listLessons("pending").filter((l) => l.ticketId === id);
  assert.ok(lesson);
  assert.equal(lesson.edited, true, "differs from the AI draft");
  for (const text of [lesson.customerMessage, lesson.finalText, lesson.aiDraft]) {
    assert.ok(!/Rachel|Cohen|gmail|973-555|S1009/.test(text), text);
  }
  const listed = await call(learnRoute.GET, { url: "http://t/api/learning?status=pending", headers: { cookie: agent.cookie } });
  assert.ok(!listed.text.includes("Rachel"));
  assert.equal(listed.json.stats.pending >= 1, true);
});

test("only the owner approves; approved lessons are promoted as masked KB examples", async () => {
  const id = await sendReply("Hi Rachel, the tulle dress runs true to size.");
  const lesson = learning.listLessons("pending").find((l) => l.ticketId === id);
  assert.equal((await call(decideRoute.POST, { method: "POST", params: { id: String(lesson.id) }, headers: { cookie: agent.cookie }, body: { decision: "approved" } })).status, 403);
  assert.equal((await call(decideRoute.POST, { method: "POST", params: { id: String(lesson.id) }, headers: { cookie: owner.cookie }, body: { decision: "approved" } })).status, 200);
  const rejected = learning.listLessons("pending")[0];
  learning.reviewLesson(rejected.id, "rejected", "owner");

  const promoted = learning.promoteApprovedLessons();
  assert.equal(promoted, 1);
  const done = learning.listLessons("promoted").find((l) => l.id === lesson.id);
  const file = join(process.env.HELPDESK_KB_DIR, done.kbPath);
  assert.ok(existsSync(file));
  const text = readFileSync(file, "utf8");
  assert.match(text, /category: learned/);
  assert.match(text, /## Reply staff sent/);
  assert.ok(!/Rachel|Cohen|gmail|S1009|customers\.bb-sim\.test/.test(text), text);
  assert.equal(learning.listLessons("rejected").some((l) => l.id === rejected.id), true);
  assert.equal(learning.promoteApprovedLessons(), 0, "nothing left to promote");
});

test("capture is idempotent per send", async () => {
  const id = await sendReply("Hello, sizes run true.");
  const key = simDb.getDb().prepare(`SELECT idem_key FROM sim_email_outbox WHERE ticket_id = ?`).get(id).idem_key;
  assert.equal(learning.captureLesson({ ticketId: id, sendKey: key, finalText: "x", actor: "a" }), null);
});
