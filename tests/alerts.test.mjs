// Owner alerts, notifications and the worker heartbeat check.

import { scratch, importApp, call, staffSession, root } from "./helpers.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const simDb = await importApp("lib/sim-db.ts");
const alerts = await importApp("lib/alerts.ts");
const notifications = await importApp("lib/notifications.ts");
const triage = await importApp("lib/triage.ts");
const workerState = await importApp("lib/worker/state.ts");
const retryRoute = await importApp("app/api/alerts/[id]/retry/route.ts");
const notifRoute = await importApp("app/api/notifications/route.ts");
const raw = new DatabaseSync(join(scratch, "sim.db"));

const owner = await staffSession({ role: "owner", displayName: "Olive" });
const agent = await staffSession({ displayName: "Andy" });

let n = 0;
const ticket = (body, subject = "Help") =>
  simDb.createSimTicket({
    customer: { sourceKey: `al-${++n}`, firstName: "Kim", lastName: "Lee", email: `kim${n}@customers.bb-sim.test` },
    subject,
    body,
  });
const alertsFor = (id) => raw.prepare(`SELECT * FROM alerts WHERE ticket_id = ?`).all(id);

test("an urgent ticket alerts the owner once, without the customer's words", () => {
  const id = ticket("I want to speak to a manager, my card number is 4111 1111 1111 1111", "Complaint");
  simDb.addSimMessage(id, "customer", "Hello?? manager please", "Kim");
  const rows = alertsFor(id);
  assert.equal(rows.length, 1, "deduplicated");
  assert.equal(rows[0].severity, "critical");
  assert.match(rows[0].subject, /Critical: SIM-\d+ Complaint/);
  assert.ok(!rows[0].body.includes("4111"), "no customer text in the email");
  assert.match(rows[0].body, /\/\?ticket=SIM-/);
  const ownerBell = notifications.myNotifications(owner.user.id);
  assert.ok(ownerBell.items.some((i) => i.ticketId === id && i.kind === "urgent"));
  assert.equal(alertsFor(ticket("What sizes does the dress come in?")).length, 0, "normal tickets don't alert");
});

test("delivery: skipped without ALERT_EMAIL, sent with it, retried then failed on errors", async () => {
  raw.exec(`UPDATE alerts SET status = 'sent'`);
  const calls = [];
  const okSend = async (m) => {
    calls.push(m);
    return "<id@ses>";
  };
  ticket("This is unacceptable, I want a refund now!!!");
  delete process.env.ALERT_EMAIL;
  assert.deepEqual(await alerts.deliverAlerts(okSend), { sent: 0, failed: 0, skipped: 1 });
  assert.equal(calls.length, 0);

  process.env.ALERT_EMAIL = "owner@example.com, bad-address";
  const id = raw.prepare(`SELECT id FROM alerts WHERE status = 'skipped' ORDER BY id DESC`).get().id;
  assert.equal((await call(retryRoute.POST, { method: "POST", params: { id: String(id) }, headers: { cookie: agent.cookie } })).status, 403);
  assert.equal((await call(retryRoute.POST, { method: "POST", params: { id: String(id) }, headers: { cookie: owner.cookie } })).status, 200);
  assert.deepEqual(await alerts.deliverAlerts(okSend), { sent: 1, failed: 0, skipped: 0 });
  assert.equal(calls[0].to, "owner@example.com", "invalid addresses are ignored");
  assert.equal(raw.prepare(`SELECT status, recipient FROM alerts WHERE id = ?`).get(id).status, "sent");

  ticket("I will dispute this charge with my bank");
  const failing = async () => {
    throw new Error("SES down");
  };
  assert.equal((await alerts.deliverAlerts(failing)).failed, 1);
  const pending = raw.prepare(`SELECT * FROM alerts WHERE status = 'pending' ORDER BY id DESC`).get();
  assert.ok(pending, "retries later");
  for (let i = 0; i < 3; i++) {
    raw.prepare(`UPDATE alerts SET next_attempt_at = datetime('now') WHERE id = ?`).run(pending.id);
    await alerts.deliverAlerts(failing);
  }
  assert.equal(raw.prepare(`SELECT status, attempts FROM alerts WHERE id = ?`).get(pending.id).status, "failed");
  delete process.env.ALERT_EMAIL;
});

test("notifications: customer replies reach the assignee; assignments notify the new assignee", async () => {
  const id = ticket("Question about sizing");
  triage.applyChanges([id], { assigneeId: agent.user.id }, owner.user.username, owner.user.id);
  let mine = notifications.myNotifications(agent.user.id);
  assert.ok(mine.items.some((i) => i.kind === "assigned" && i.ticketId === id));
  simDb.addSimMessage(id, "customer", "Any update on sizing?", "Kim");
  mine = notifications.myNotifications(agent.user.id);
  assert.ok(mine.items.some((i) => i.kind === "reply" && i.ticketId === id));
  const grouped = notifications.groupNotifications(mine.items).find((g) => g.ticketId === id);
  assert.ok(grouped, "ticket updates are grouped together");
  assert.ok(grouped.count >= 2, "assignment and reply updates for one ticket share a bell row");
  assert.equal(grouped.unread, true);
  assert.equal(grouped.items.length, grouped.count, "the group retains its full activity history");
  assert.equal(grouped.ids.length, grouped.count, "opening the group can mark every update read");
  const escalation = notifications.groupNotifications([
    { id: 20, kind: "urgent", ticketId: "SIM-9001", text: "Critical: SIM-9001 Damaged item", createdAt: "2026-10-24T12:02:00Z", read: false },
    { id: 19, kind: "urgent", ticketId: "SIM-9001", text: "High priority: SIM-9001 Damaged item", createdAt: "2026-10-24T12:00:00Z", read: true },
  ])[0];
  assert.match(escalation.text, /Priority increased from High to Critical: SIM-9001 Damaged item/);
  // Assigning yourself doesn't notify you
  const before = notifications.myNotifications(owner.user.id).items.length;
  triage.applyChanges([id], { assigneeId: owner.user.id }, owner.user.username, owner.user.id);
  assert.equal(notifications.myNotifications(owner.user.id).items.length, before);

  const r = await call(notifRoute.POST, { method: "POST", headers: { cookie: agent.cookie }, body: { all: true } });
  assert.equal(r.json.unread, 0);
  assert.equal((await call(notifRoute.GET)).status, 401);
});

test("rate-limited alert retries are scheduled after the hourly window and do not bypass the cap", async () => {
  raw.exec(`DELETE FROM alerts`);
  process.env.ALERT_EMAIL = "owner@example.com";
  try {
    for (let i = 0; i < 30; i++) {
      raw.prepare(`INSERT INTO alerts (kind, subject, body, dedupe_key, status, sent_at) VALUES ('test', ?, '', ?, 'sent', datetime('now'))`)
        .run("Sent " + i, "rate-limit-" + i);
    }
    const id = ticket("I will take legal action over this refund");
    const alertId = Number(raw.prepare(`SELECT id FROM alerts WHERE ticket_id = ?`).get(id).id);
    let sends = 0;
    await alerts.deliverAlerts(async () => {
      sends++;
      return "<should-not-send@ses>";
    });
    const skipped = raw.prepare(`SELECT status, last_error, next_attempt_at FROM alerts WHERE id = ?`).get(alertId);
    assert.equal(skipped.status, "skipped");
    assert.match(skipped.last_error, /Rate limit: 30 alert emails per hour/);
    assert.ok(Date.parse(skipped.next_attempt_at.replace(" ", "T") + "Z") > Date.now() + 58 * 60_000);

    // Older rows used this message and may still have a stale due timestamp. The API
    // should show their current eligibility, including the active cap's next window.
    raw.prepare(`UPDATE alerts SET last_error = 'Too many alerts this hour', next_attempt_at = datetime('now') WHERE id = ?`).run(alertId);
    const legacy = alerts.listAlerts().alerts.find((a) => a.id === alertId);
    assert.match(legacy.lastError, /^Rate limit:/);
    assert.ok(Date.parse(legacy.nextAttemptAt) > Date.now() + 58 * 60_000);

    const retried = await call(retryRoute.POST, { method: "POST", params: { id: String(alertId) }, headers: { cookie: owner.cookie } });
    assert.equal(retried.status, 200);
    assert.equal(retried.json.rateLimited, true);
    assert.ok(retried.json.nextAttemptAt);
    assert.equal(raw.prepare(`SELECT status FROM alerts WHERE id = ?`).get(alertId).status, "pending");
    raw.prepare(`UPDATE alerts SET next_attempt_at = datetime('now') WHERE id = ?`).run(alertId);
    await alerts.deliverAlerts(async () => {
      sends++;
      return "<must-not-send@ses>";
    });
    assert.equal(sends, 0, "the cap is checked again before sending even if a queued retry is due");
    assert.equal(raw.prepare(`SELECT status FROM alerts WHERE id = ?`).get(alertId).status, "skipped");
  } finally {
    // Prevent the synthetic 30/hour cap from leaking into later tests.
    raw.exec(`DELETE FROM alerts`);
    delete process.env.ALERT_EMAIL;
  }
});

test("heartbeat check: one alert when the worker stops, one when it's back", () => {
  const run = () =>
    spawnSync(
      process.execPath,
      ["--no-warnings", "--import", fileURLToPath(new URL("scripts/register-ts.mjs", root)), fileURLToPath(new URL("scripts/heartbeat-check.ts", root))],
      { cwd: scratch, env: { ...process.env }, encoding: "utf8" },
    );
  workerState.setState("heartbeat", { pid: 1, startedAt: new Date().toISOString(), current: null, lastJobAt: null });
  raw.exec(`UPDATE worker_state SET updated_at = datetime('now', '-10 minutes') WHERE key = 'heartbeat'`);
  let out = run();
  assert.match(out.stdout, /worker DOWN/, out.stderr);
  out = run();
  assert.match(out.stdout, /still down/);
  assert.equal(raw.prepare(`SELECT count(*) AS c FROM alerts WHERE kind = 'worker_down'`).get().c, 1);
  workerState.setState("heartbeat", { pid: 2, startedAt: new Date().toISOString(), current: null, lastJobAt: null });
  out = run();
  assert.match(out.stdout, /recovered/);
  assert.equal(raw.prepare(`SELECT count(*) AS c FROM alerts WHERE kind = 'worker_recovered'`).get().c, 1);
});

test("an alert interrupted mid-send is retried", async () => {
  raw.exec(`UPDATE alerts SET status = 'sent' WHERE status != 'sent'`);
  ticket("I will take legal action over this refund");
  const id = raw.prepare(`SELECT id FROM alerts ORDER BY id DESC`).get().id;
  raw.prepare(`UPDATE alerts SET status = 'sending', next_attempt_at = datetime('now', '-11 minutes') WHERE id = ?`).run(id);
  process.env.ALERT_EMAIL = "owner@example.com";
  const r = await alerts.deliverAlerts(async () => "<id@ses>");
  assert.equal(r.sent, 1);
  assert.equal(raw.prepare(`SELECT status FROM alerts WHERE id = ?`).get(id).status, "sent");
  delete process.env.ALERT_EMAIL;
});
