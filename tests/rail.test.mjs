// Customer rail: store snapshots (cached, stale fallback), simulated-only reads, returns.

import { importApp, call, stubModule } from "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

// Fake demo store for lib/store.ts, controlled through globalThis.__d1
stubModule(
  "./store-d1.mjs",
  `export function storeConfig() { return globalThis.__d1.configured ? { accountId: "a", databaseId: "d", token: "t" } : null; }
   export async function getSimCustomerWithOrders(_c, id) { globalThis.__d1.calls++; return globalThis.__d1.impl(id); }
   export async function getSimOrderCustomerId(_c, name) { return name === "#S1001" ? "7" : null; }`,
);
const fixture = {
  customer: { id: 7, email: "sim@customers.bb-sim.test", first_name: "Sim", last_name: "One", city: "Newark", province_code: "NJ", country_code: "US", orders_count: 2, total_spent: "120.00", tags: "simulated", created_at: "2026-10-01" },
  orders: [
    {
      id: 1, name: "#S1001", total_price: "89.00", currency: "USD", financial_status: "paid", fulfillment_status: null, cancelled_at: null, created_at: "2026-10-10",
      line_items: [{ title: "Tulle Dress - 4T", quantity: 1, price: "89.00", sku: "TD4" }],
      fulfillments: [], refunds: [],
    },
    {
      id: 2, name: "#S1000", total_price: null, currency: "USD", financial_status: "paid", fulfillment_status: "fulfilled", cancelled_at: null, created_at: "2026-09-10",
      line_items: [], fulfillments: [{ status: "success", tracking_company: "USPS", tracking_number: "9400", shipment_status: "delivered" }], refunds: [],
    },
  ],
};
globalThis.__d1 = { configured: true, calls: 0, impl: async () => fixture };

const simDb = await importApp("lib/sim-db.ts");
const { railForTicket } = await importApp("lib/store.ts");
const { returnsForTicket } = await importApp("lib/returns.ts");
const simTickets = await importApp("app/api/helpdesk/sim/tickets/route.ts");
const bearer = { authorization: `Bearer ${process.env.SIM_API_KEY}` };

const customer = { sourceKey: "rail-1", firstName: "Sim", lastName: "One", email: "sim@customers.bb-sim.test", storeCustomerId: "7" };
const open = (extra = {}) =>
  call(simTickets.POST, { method: "POST", headers: bearer, body: { customer, subject: "Return", body: "I want to return the dress", orderName: "#S1001", ...extra } });

test("a simulated ticket can carry a return for its order; bad order names are refused", async () => {
  const r = await open({ simReturn: { kind: "return", status: "in_transit", items: ["Tulle Dress - 4T"] } });
  assert.equal(r.status, 201);
  const returns = returnsForTicket(r.json.ticket.id);
  assert.equal(returns.length, 1);
  assert.equal(returns[0].status, "in_transit");
  assert.equal((await open({ orderName: "#1234", simReturn: { kind: "return" } })).status, 400);
});

test("returns show only for an order on the same customer's tickets", async () => {
  const mine = (await open()).json.ticket.id;
  assert.equal(returnsForTicket(mine).length, 1);
  const stranger = simDb.createSimTicket({
    customer: { sourceKey: "rail-2", firstName: "Other", lastName: "Person", email: "o@customers.bb-sim.test" },
    subject: "Hi",
    body: "Hello",
    orderName: "#S1001",
  });
  assert.equal(returnsForTicket(stranger).length, 0, "another customer can't see this order's return");
  assert.equal(returnsForTicket(mine, "#S9999").length, 0);
});

test("rail: matched order, history, and 'unavailable' instead of $0", async () => {
  const id = (await open()).json.ticket.id;
  const rail = await railForTicket(id);
  assert.equal(rail.available, true);
  assert.equal(rail.snapshot.matchedOrder.name, "#S1001");
  assert.equal(rail.snapshot.matchedOrder.items[0].price, 89);
  const older = rail.snapshot.orders.find((o) => o.name === "#S1000");
  assert.equal(older.total, null, "missing total stays null (shown as unavailable)");
  assert.equal(rail.snapshot.storeCredit, null);
  assert.equal(rail.returns.length, 1);
});

test("rail is cached; a failed refresh shows the last good read as stale", async () => {
  const id = (await open()).json.ticket.id;
  globalThis.__d1.calls = 0;
  await railForTicket(id);
  await railForTicket(id);
  assert.equal(globalThis.__d1.calls, 1, "second read served from the snapshot");
  globalThis.__d1.impl = async () => {
    throw new Error("Store database: timeout");
  };
  const stale = await railForTicket(id, { refresh: true });
  assert.equal(stale.stale, true);
  assert.equal(stale.snapshot.matchedOrder.name, "#S1001");
  assert.match(stale.error, /timeout/);
  // No snapshot yet and the store is down: no data, with the reason
  const fresh = (await open()).json.ticket.id;
  const down = await railForTicket(fresh);
  assert.equal(down.available, false);
  globalThis.__d1.impl = async () => fixture;
});

test("rail never reads the store for real email customers or when it isn't connected", async () => {
  const email = simDb.ingestEmail({
    customer: { sourceKey: "email:abc", firstName: "Real", lastName: "Person", email: "real@example.com" },
    subject: "Order",
    body: "Where is it?",
    tags: "email",
    messageId: "<x@example.com>",
    refs: [],
  }).ticketId;
  globalThis.__d1.calls = 0;
  const r = await railForTicket(email);
  assert.equal(r.available, false);
  assert.match(r.reason, /simulated customers/);
  assert.equal(globalThis.__d1.calls, 0);
  globalThis.__d1.configured = false;
  const id = (await open()).json.ticket.id;
  assert.match((await railForTicket(id)).reason, /isn't connected/);
  globalThis.__d1.configured = true;
});

test("older tickets find their store customer through the simulated order", async () => {
  const id = simDb.createSimTicket({
    customer: { sourceKey: "rail-old", firstName: "Old", lastName: "Ticket", email: "old@customers.bb-sim.test" },
    subject: "Where is it",
    body: "Hello",
    orderName: "#S1001",
  });
  const r = await railForTicket(id);
  assert.equal(r.available, true);
  assert.equal(r.snapshot.matchedOrder.name, "#S1001");
});
