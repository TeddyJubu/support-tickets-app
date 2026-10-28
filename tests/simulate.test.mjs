// `npm run simulate -- --reset` deletes simulated tickets only: real email tickets, their
// customers and the record of emails sent to them stay.

import { scratch, importApp } from "./helpers.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const simDb = await importApp("lib/sim-db.ts");
const { resetSimulated } = await importApp("scripts/sim-reset.mjs");
simDb.getDb();
const raw = new DatabaseSync(join(scratch, "sim.db"));
const count = (sql, ...args) => raw.prepare(sql).get(...args).c;

test("reset deletes simulated tickets and keeps email tickets and their sent mail", () => {
  const sim = simDb.createSimTicket({
    customer: { sourceKey: "sim-reset-1", firstName: "Sim", lastName: "One", email: "sim1@customers.bb-sim.test" },
    subject: "Sizing",
    body: "Does it run small?",
  });
  simDb.addSimMessage(sim, "agent", "It runs true to size.", "Dana");
  const email = simDb.ingestEmail({
    customer: { sourceKey: "email:abc123", firstName: "Real", lastName: "Customer", email: "real@example.com" },
    subject: "Where is my order?",
    body: "Where is my order?",
    tags: "email",
    messageId: "<real-1@example.com>",
    refs: [],
  }).ticketId;
  raw.prepare(`INSERT INTO sim_email_outbox (idem_key, ticket_id, body, status, message_id) VALUES ('k-real', ?, 'It shipped.', 'sent', '<out-1@ses>')`).run(email);
  raw.prepare(`INSERT INTO ticket_tags (ticket_id, tag) VALUES (?, 'vip')`).run(email);

  const result = resetSimulated(new DatabaseSync(join(scratch, "sim.db")));
  assert.deepEqual(result, { tickets: 1, customers: 1, kept: 1 });

  assert.equal(count(`SELECT count(*) AS c FROM sim_tickets WHERE id = ?`, sim), 0);
  assert.equal(count(`SELECT count(*) AS c FROM sim_messages WHERE ticket_id = ?`, sim), 0);
  assert.equal(count(`SELECT count(*) AS c FROM jobs WHERE ticket_id = ?`, sim), 0);
  assert.equal(count(`SELECT count(*) AS c FROM sim_customers WHERE source_key = 'sim-reset-1'`), 0);

  assert.equal(count(`SELECT count(*) AS c FROM sim_tickets WHERE id = ?`, email), 1);
  assert.equal(count(`SELECT count(*) AS c FROM sim_messages WHERE ticket_id = ?`, email), 1);
  assert.equal(count(`SELECT count(*) AS c FROM sim_email_outbox WHERE ticket_id = ?`, email), 1);
  assert.equal(count(`SELECT count(*) AS c FROM sim_email_ids WHERE ticket_id = ?`, email), 1);
  assert.equal(count(`SELECT count(*) AS c FROM ticket_tags WHERE ticket_id = ? AND tag = 'vip'`, email), 1);
  assert.equal(count(`SELECT count(*) AS c FROM sim_customers WHERE source_key = 'email:abc123'`), 1);

  // Numbering carries on: a new ticket never reuses a number an alert or audit row points at
  const next = simDb.createSimTicket({
    customer: { sourceKey: "sim-reset-2", firstName: "Sim", lastName: "Two", email: "sim2@customers.bb-sim.test" },
    subject: "Colors",
    body: "Is it in blue?",
  });
  assert.ok(Number(next.slice(4)) > Number(email.slice(4)), next);
});
