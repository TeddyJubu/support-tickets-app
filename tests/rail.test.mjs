// Store data from Shopify (faked here, no network): only a verified email sender's own customer
// record and orders, cached with a stale fallback; simulated tickets have none. Also returns.

import { importApp, call, staffSession } from "./helpers.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

// Fake Shopify: the client credentials token endpoint and the Admin GraphQL API
const SHOP = "cute-things-test";
process.env.SHOPIFY_SHOP = SHOP;
process.env.SHOPIFY_CLIENT_ID = "test-client-id";
process.env.SHOPIFY_CLIENT_SECRET = "test-client-secret-never-shown";

const ANN = "gid://shopify/Customer/101";
const BOB = "gid://shopify/Customer/202";
const JO = "gid://shopify/Customer/303";
const money = (amount, currencyCode = "USD") => ({ shopMoney: { amount, currencyCode } });
const order = (name, customerId, extra = {}) => ({
  name,
  createdAt: "2026-10-10T15:00:00Z",
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "UNFULFILLED",
  currencyCode: "USD",
  totalPriceSet: money("89.00"),
  customer: { id: customerId },
  lineItems: { nodes: [{ title: "Tulle Dress - 4T", quantity: 1, sku: "TD4", originalUnitPriceSet: money("89.00") }] },
  fulfillments: [],
  refunds: [],
  ...extra,
});
const ORDERS = [
  order("#1001", ANN),
  order("#1000", ANN, {
    createdAt: "2026-09-10T15:00:00Z",
    totalPriceSet: null,
    displayFinancialStatus: "PARTIALLY_REFUNDED",
    displayFulfillmentStatus: "FULFILLED",
    lineItems: { nodes: [{ title: "Bib", quantity: 2, sku: null, originalUnitPriceSet: null }] },
    fulfillments: [{ status: "SUCCESS", displayStatus: "DELIVERED", createdAt: "2026-09-11T00:00:00Z", trackingInfo: [{ company: "USPS", number: "9400" }] }],
    refunds: [{ createdAt: "2026-09-20T00:00:00Z", note: null, totalRefundedSet: null }],
  }),
  // Older than the customer's ten recent orders: only found by name
  order("#900", ANN, { createdAt: "2025-01-05T15:00:00Z", old: true }),
  order("#2002", BOB),
];
const CUSTOMERS = [
  { id: ANN, firstName: "Ann", lastName: "Lee", email: "Ann@Example.com" },
  { id: BOB, firstName: "Bob", lastName: "Stone", email: "bob@example.com" },
  { id: JO, firstName: "Jo", lastName: "Ann", email: "joann@example.com" },
];

const fake = { tokens: 0, issued: null, revoked: new Set(), requests: [], queue: [], down: false, signInError: null };
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function answer(query, vars) {
  if (/CustomerByEmail/.test(query)) {
    const want = /^email:"(.+)"$/.exec(vars.query)?.[1] ?? "";
    // Shopify's search is fuzzy: "ann@example.com" also finds "joann@example.com"
    const nodes = CUSTOMERS.filter((c) => c.email.toLowerCase().includes(want)).map((c) => ({ id: c.id, defaultEmailAddress: { emailAddress: c.email } }));
    return { customers: { nodes } };
  }
  if (/CustomerWithOrders/.test(query)) {
    const c = CUSTOMERS.find((x) => x.id === vars.id);
    if (!c) return { customer: null };
    const own = ORDERS.filter((o) => o.customer.id === c.id && !o.old);
    // A stray order of someone else's, which the client must drop
    const stray = ORDERS.find((o) => o.customer.id !== c.id && !o.old);
    return {
      customer: {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        defaultEmailAddress: { emailAddress: c.email },
        defaultAddress: { city: "Newark", provinceCode: "NJ", countryCodeV2: "US" },
        numberOfOrders: String(own.length),
        amountSpent: money("178.00"),
        createdAt: "2025-01-01T00:00:00Z",
        orders: { nodes: [...own, stray] },
      },
    };
  }
  if (/OrdersByName/.test(query)) {
    const want = /^name:"#?(.+)"$/.exec(vars.query)?.[1]?.toLowerCase();
    return { orders: { nodes: ORDERS.filter((o) => o.name.replace(/^#/, "").toLowerCase() === want) } };
  }
  if (/shop\s*\{\s*name/.test(query)) return { shop: { name: "Cute Things" } };
  throw new Error(`fake Shopify: unexpected query ${query.slice(0, 60)}`);
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = init.body ? JSON.parse(init.body) : null;
  const token = init.headers?.["x-shopify-access-token"];
  fake.requests.push({ url: url.href, body, token });
  if (url.host !== `${SHOP}.myshopify.com`) throw new Error(`unexpected fetch to ${url.host}`);
  if (url.pathname === "/admin/oauth/access_token") {
    if (fake.signInError) return json({ error: fake.signInError }, 400);
    fake.issued = `token-${++fake.tokens}`;
    return json({ access_token: fake.issued, scope: "read_customers,read_orders", expires_in: 86399 });
  }
  if (url.pathname !== "/admin/api/2026-10/graphql.json") return json({ errors: "Not Found" }, 404);
  if (fake.queue.length) return fake.queue.shift()();
  if (fake.down) return json({ errors: "Service Unavailable" }, 503, { "retry-after": "0" });
  if ((token !== fake.issued && token !== "shpat_fixed") || fake.revoked.has(token)) {
    return json({ errors: "[API] Invalid API key or access token" }, 401);
  }
  return json({ data: answer(body.query, body.variables ?? {}) });
};
const calls = () => fake.requests.length;

const simDb = await importApp("lib/sim-db.ts");
const { railForTicket, orderForTicket } = await importApp("lib/store.ts");
const { shopifyConfig, shopifyQuery, resetShopifyToken, findCustomerIdByEmail, DEFAULT_API_VERSION } = await importApp("lib/shopify.ts");
const { runTool } = await importApp("lib/drafting/tools.ts");
const { returnsForTicket } = await importApp("lib/returns.ts");
const simTickets = await importApp("app/api/helpdesk/sim/tickets/route.ts");
const bearer = { authorization: `Bearer ${process.env.SIM_API_KEY}` };
resetShopifyToken();

const sha = (v) => createHash("sha256").update(v).digest("hex");
let seq = 0;
/** An inbound email, filed the way the SES webhook files it (key = sha256 of the address) */
function email({ from = "ann@example.com", body = "Hi, where is order #1001?", verified = true, key = from, refs = [], subject } = {}) {
  const messageId = `<m${++seq}@example.com>`;
  const r = simDb.ingestEmail({
    customer: { sourceKey: `email:${sha(key)}`, firstName: "Ann", lastName: "Lee", email: from },
    subject: subject ?? `Order question ${seq}`,
    body,
    channel: "email",
    tags: "email",
    senderVerified: verified,
    messageId,
    refs,
  });
  return { id: r.ticketId, created: r.created, messageId };
}
const verifiedFlag = (id) => simDb.getDb().prepare(`SELECT sender_verified AS v FROM sim_tickets WHERE id = ?`).get(id).v;
const ctx = (ticketId) => ({ ticketId, customerId: null, orderName: null, kbTitles: new Set(), kbSensitiveTitles: new Set(), calls: [] });

const customer = { sourceKey: "rail-1", firstName: "Sim", lastName: "One", email: "sim@customers.bb-sim.test" };
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

test("the rail shows the verified sender's own Shopify customer and orders", async () => {
  const tokens = fake.tokens;
  const { id } = email();
  const rail = await railForTicket(id);
  assert.equal(rail.available, true, rail.reason);
  assert.equal(rail.snapshot.customer.name, "Ann Lee", "found by exact address, despite the fuzzy match on joann@");
  assert.equal(rail.snapshot.customer.location, "Newark, NJ, US");
  assert.equal(rail.snapshot.matchedOrder.name, "#1001");
  assert.equal(rail.snapshot.matchedOrder.payment, "paid");
  assert.equal(rail.snapshot.matchedOrder.items[0].price, 89);
  assert.deepEqual(rail.snapshot.orders.map((o) => o.name), ["#1001", "#1000"], "another customer's stray order is dropped");
  assert.equal(fake.tokens - tokens, 1, "signed in once");
});

test("a near-match address doesn't find someone else's record", async () => {
  // "nn@example.com" fuzzily matches ann@ and joann@, but neither exactly
  const { id } = email({ from: "nn@example.com" });
  const rail = await railForTicket(id);
  assert.equal(rail.available, false);
  assert.equal(rail.reason, "No customer in the Shopify store has this email address.");
  assert.equal((await orderForTicket(id, "#1001")).status, 404);
});

test("a ticket can't reach another customer's orders", async () => {
  const { id } = email({ body: "Can you check order #2002 for me?" });
  const rail = await railForTicket(id);
  assert.equal(rail.snapshot.matchedOrder, null);
  assert.ok(!rail.snapshot.orders.some((o) => o.name === "#2002"));
  const out = await orderForTicket(id, "#2002");
  assert.equal(out.status, 404);
  assert.match(out.error, /isn't one of this customer's orders/);
  assert.deepEqual(out.recent.map((o) => o.name), ["#1001", "#1000"]);
  assert.equal((await orderForTicket(id, '#1" OR name:*')).status, 400);
  const tool = JSON.parse(await runTool("get_order", { order_name: "#2002" }, ctx(id)));
  assert.match(tool.error, /isn't one of this customer's orders/);
  // Bob's own ticket does see it
  const bob = email({ from: "bob@example.com", body: "Where is #2002?" }).id;
  assert.equal((await orderForTicket(bob)).order.name, "#2002");
});

test("an older order the ticket names is checked by name and listed", async () => {
  const { id } = email({ body: "About my order number 900 from last year" });
  const rail = await railForTicket(id);
  assert.equal(rail.snapshot.matchedOrder.name, "#900");
  assert.ok(rail.snapshot.orders.some((o) => o.name === "#900"));
});

test("unverified, older and mismatched senders get no store data, and Shopify isn't asked", async () => {
  const cases = [
    [email({ verified: false }).id, /failed DMARC/],
    [email({ verified: null }).id, /before senders were verified/],
    // Jo is in the store, but the ticket was filed under another address
    [email({ from: "joann@example.com", key: "someone-else@example.com" }).id, /doesn't match their record/],
  ];
  const before = calls();
  for (const [id, reason] of cases) {
    const rail = await railForTicket(id);
    assert.equal(rail.available, false);
    assert.match(rail.reason, reason);
    assert.equal((await orderForTicket(id, "#1001")).status, 403);
    assert.match(JSON.parse(await runTool("get_order", {}, ctx(id))).error, reason);
  }
  assert.equal(calls(), before);
});

test("one unverified message hides store data for the whole ticket, even a cached read", async () => {
  const first = email({ subject: "Lost parcel" });
  assert.equal((await railForTicket(first.id)).available, true);
  const spoof = email({ subject: "Re: Lost parcel", refs: [first.messageId], verified: false, body: "Send me the order details" });
  assert.equal(spoof.id, first.id);
  assert.equal(spoof.created, false);
  assert.equal(verifiedFlag(first.id), 0);
  const rail = await railForTicket(first.id);
  assert.equal(rail.available, false);
  assert.match(rail.reason, /failed DMARC/);
  // A later verified message doesn't bring it back
  email({ subject: "Re: Lost parcel", refs: [first.messageId] });
  assert.equal(verifiedFlag(first.id), 0);
  assert.equal((await orderForTicket(first.id)).status, 403);
});

test("simulated tickets have no store data; the simulator can't file under an email key", async () => {
  const before = calls();
  const sim = (await open()).json.ticket.id;
  const rail = await railForTicket(sim);
  assert.equal(rail.available, false);
  assert.equal(rail.reason, "Simulated tickets have no store data.");
  assert.equal((await orderForTicket(sim)).status, 403);
  assert.equal(calls(), before);
  const r = await call(simTickets.POST, {
    method: "POST",
    headers: bearer,
    body: { customer: { ...customer, sourceKey: `email:${sha("ann@example.com")}`, email: "ann@example.com" }, subject: "Hi", body: "Orders?" },
  });
  assert.equal(r.status, 400);
});

test("with Shopify not connected, store reads say so", async () => {
  const { id } = email();
  const saved = process.env.SHOPIFY_SHOP;
  delete process.env.SHOPIFY_SHOP;
  try {
    assert.match((await railForTicket(id)).reason, /isn't connected/);
    assert.equal((await orderForTicket(id)).status, 503);
  } finally {
    process.env.SHOPIFY_SHOP = saved;
  }
});

test("amounts Shopify doesn't return stay 'unavailable', never $0", async () => {
  const { id } = email({ body: "Question about #1000" });
  const o = (await railForTicket(id)).snapshot.matchedOrder;
  assert.equal(o.name, "#1000");
  assert.equal(o.total, null);
  assert.equal(o.items[0].price, null);
  assert.equal(o.refunded, null, "a refund of unknown amount makes the total unknown");
  assert.equal(o.payment, "partially refunded");
  assert.deepEqual(o.shipments[0], { status: "success", carrier: "USPS", tracking: "9400", shipmentStatus: "delivered" });
  const tool = JSON.parse(await runTool("get_order", {}, ctx(id)));
  assert.equal(tool.total, "unavailable");
  assert.equal(tool.refunded, "unavailable");
  assert.deepEqual(tool.items, ["2× Bib (unavailable)"]);
});

test("get_order gives the drafter only what a reply needs", async () => {
  const { id } = email();
  const raw = await runTool("get_order", {}, ctx(id));
  const out = JSON.parse(raw);
  assert.equal(out.name, "#1001");
  assert.equal(out.total, "$89.00");
  assert.deepEqual(Object.keys(out).sort(), ["cancelled", "fulfillment", "items", "name", "payment", "placed", "refunded", "shipments", "total"]);
  assert.doesNotMatch(raw, /example\.com|Newark|gid:\/\//i);
});

test("reads are cached; when Shopify fails the last good read shows as stale", async () => {
  const { id } = email();
  await railForTicket(id);
  const before = calls();
  await railForTicket(id);
  assert.equal(calls(), before, "second read served from the snapshot");
  fake.down = true;
  try {
    const stale = await railForTicket(id, { refresh: true });
    assert.equal(stale.stale, true);
    assert.equal(stale.snapshot.matchedOrder.name, "#1001");
    assert.match(stale.error, /HTTP 503/);
    // Once the read is old, the drafter and copilot get an error, never the stale order
    simDb.getDb().prepare(`UPDATE store_snapshots SET fetched_at = datetime('now', '-10 minutes') WHERE ticket_id = ?`).run(id);
    const out = await orderForTicket(id);
    assert.equal(out.status, 502);
    assert.ok(!("order" in out));
    // No read yet and Shopify down: no data, with the reason
    const down = await railForTicket(email().id);
    assert.equal(down.available, false);
    assert.match(down.reason, /couldn't be reached: Shopify: HTTP 503/);
  } finally {
    fake.down = false;
  }
});

test("sign-in: one token is reused and renewed after a 401; throttling is retried", async () => {
  const config = shopifyConfig();
  resetShopifyToken();
  const tokens = fake.tokens;
  const shopName = () => shopifyQuery(config, "{ shop { name } }").then((d) => d.shop.name);
  await shopName();
  assert.equal(await shopName(), "Cute Things");
  assert.equal(fake.tokens - tokens, 1);
  fake.revoked.add(fake.issued);
  assert.equal(await shopName(), "Cute Things");
  assert.equal(fake.tokens - tokens, 2, "renewed once after the 401");

  // Throttled in a 200 body, then a 429 with a plain-string error: both retried
  fake.queue.push(
    () =>
      json({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: { cost: { requestedQueryCost: 10, throttleStatus: { currentlyAvailable: 9, restoreRate: 100 } } },
      }),
    () => json({ errors: "Exceeded 2 calls per second for api client." }, 429, { "retry-after": "0" }),
  );
  assert.equal(await shopName(), "Cute Things");
  // Still throttled after three tries: an error that says so
  fake.queue.push(...Array.from({ length: 3 }, () => () => json({ errors: "Exceeded" }, 429, { "retry-after": "0" })));
  await assert.rejects(shopName(), /HTTP 429 \(rate limited\)/);
  // A GraphQL error inside a 200 is still an error
  fake.queue.push(() => json({ errors: [{ message: "Access denied for customers field." }] }));
  await assert.rejects(shopName(), /Access denied/);

  // A refused sign-in names Shopify's error code, never the secret
  resetShopifyToken();
  fake.signInError = "shop_not_permitted";
  try {
    const err = await shopName().catch((e) => e);
    assert.match(err.message, /^Shopify sign-in failed: shop_not_permitted$/);
  } finally {
    fake.signInError = null;
  }

  // A fixed Admin API token is used as is
  const fixed = shopifyConfig({ SHOPIFY_SHOP: SHOP, SHOPIFY_ADMIN_TOKEN: "shpat_fixed" });
  const before = fake.tokens;
  assert.equal((await shopifyQuery(fixed, "{ shop { name } }")).shop.name, "Cute Things");
  assert.equal(fake.tokens, before);
  assert.equal(fake.requests.at(-1).token, "shpat_fixed");
});

test("store routes are for signed-in staff, and order lookups need a ticket", async () => {
  const staff = await staffSession();
  const { id } = email();
  const orders = await importApp("app/api/helpdesk/orders/route.ts");
  const store = await importApp("app/api/helpdesk/tickets/[id]/store/route.ts");
  const url = `http://t/api/helpdesk/orders?ticket=${id}`;
  assert.equal((await call(orders.GET, { url })).status, 401);
  assert.equal((await call(orders.GET, { url, headers: bearer })).status, 401, "the simulator/CLI key can't read store data");
  assert.equal((await call(orders.GET, { url: "http://t/api/helpdesk/orders?name=%231001", headers: { cookie: staff.cookie } })).status, 400);
  const ok = await call(orders.GET, { url, headers: { cookie: staff.cookie } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.order.name, "#1001");
  assert.equal((await call(store.GET, { params: { id }, headers: bearer })).status, 401);
  const rail = await call(store.GET, { params: { id }, headers: { cookie: staff.cookie } });
  assert.equal(rail.status, 200);
  assert.equal(rail.json.snapshot.customer.name, "Ann Lee");
});

test("inbound email is verified only on a DMARC pass; tickets staff open are verified", async () => {
  process.env.INBOUND_EMAIL_TOKEN = "test-inbound-token-0123456789";
  process.env.INBOUND_SNS_TOPIC_ARN = "arn:aws:sns:us-west-2:1:helpdesk";
  const ses = await importApp("app/api/helpdesk/inbound/ses/route.ts");
  for (const [dmarc, want] of [["PASS", 1], ["FAIL", 0], ["GRAY", 0], [null, 0]]) {
    const n = ++seq;
    const mime = [
      `From: Sender ${n} <sender${n}@example.com>`,
      "To: support@teddyonfriday.com",
      `Subject: Where is my order ${n}`,
      `Message-ID: <ses-${n}@example.com>`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hello",
    ].join("\r\n");
    const receipt = { action: { type: "SNS" }, ...(dmarc ? { dmarcVerdict: { status: dmarc } } : {}) };
    const r = await call(ses.POST, {
      method: "POST",
      url: `http://t/api/helpdesk/inbound/ses?token=${process.env.INBOUND_EMAIL_TOKEN}`,
      body: {
        TopicArn: process.env.INBOUND_SNS_TOPIC_ARN,
        Type: "Notification",
        Message: JSON.stringify({ receipt, mail: { messageId: `ses-${n}` }, content: Buffer.from(mime).toString("base64") }),
      },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(verifiedFlag(r.json.ticketId), want, `DMARC ${dmarc}`);
  }
  const staff = await staffSession();
  const tickets = await importApp("app/api/helpdesk/tickets/route.ts");
  const r = await call(tickets.POST, { method: "POST", headers: { cookie: staff.cookie }, body: { email: "Ann@Example.com", subject: "Following up" } });
  assert.equal(r.status, 201, r.text);
  assert.equal(verifiedFlag(r.json.ticket.id), 1);
  assert.equal((await railForTicket(r.json.ticket.id)).snapshot.customer.name, "Ann Lee");
});

test("only read queries go to Shopify, and only to the configured shop", async () => {
  const config = shopifyConfig();
  const before = calls();
  for (const q of ['mutation { customerDelete(input: { id: "x" }) { deletedCustomerId } }', "  Mutation M { x }", "subscription { x }"]) {
    await assert.rejects(shopifyQuery(config, q), /Only read queries/);
  }
  // A search value that could break out of its quotes is never sent
  assert.equal(await findCustomerIdByEmail(config, 'x" OR email:*@example.com'), null);
  assert.equal(calls(), before);

  assert.equal(shopifyConfig({ SHOPIFY_SHOP: "https://Cute-Things.myshopify.com/", SHOPIFY_ADMIN_TOKEN: "x" }).shop, "cute-things");
  assert.equal(shopifyConfig({ SHOPIFY_SHOP: "evil.example/x", SHOPIFY_ADMIN_TOKEN: "x" }), null);
  assert.equal(shopifyConfig({ SHOPIFY_SHOP: "cute-things", SHOPIFY_CLIENT_ID: "id" }), null, "a client id alone isn't enough");
  assert.equal(shopifyConfig({ SHOPIFY_SHOP: "cute-things", SHOPIFY_ADMIN_TOKEN: "x", SHOPIFY_API_VERSION: "latest" }).apiVersion, DEFAULT_API_VERSION);

  // Everything this file sent: queries only, all to the test shop
  assert.ok(fake.requests.length > 20);
  for (const r of fake.requests) {
    assert.equal(new URL(r.url).host, `${SHOP}.myshopify.com`);
    if (r.body?.query) assert.doesNotMatch(r.body.query, /\b(mutation|subscription)\b/i);
  }
});
