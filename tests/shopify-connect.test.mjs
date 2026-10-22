// Connecting a Shopify store from Settings (faked here, no network): Shopify's approval
// redirect is checked (HMAC, state, owner), keys are saved encrypted and refreshed one process
// at a time, a refused key asks the owner to reconnect, Disconnect uninstalls the app, and
// Shopify's webhooks are signed and answer with no data.

import { importApp, call, staffSession } from "./helpers.mjs";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";

const SHOP = "buyer-store";
const SECRET = "test-app-secret-never-shown";
process.env.SHOPIFY_CLIENT_ID = "test-app-id";
process.env.SHOPIFY_CLIENT_SECRET = SECRET;
process.env.HELPDESK_PUBLIC_URL = "https://help.example.test";

// Fake Shopify: the OAuth token endpoint (code exchange, refresh) and the Admin GraphQL API
const fake = { n: 0, code: "good-code", scope: "read_customers,read_orders", access: null, refresh: null, refreshes: 0, uninstalls: [], requests: [] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function issue() {
  fake.n++;
  fake.access = `at-${fake.n}`;
  fake.refresh = `rt-${fake.n}`;
  return json({ access_token: fake.access, expires_in: 3600, refresh_token: fake.refresh, refresh_token_expires_in: 7776000, scope: fake.scope });
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  fake.requests.push(url.pathname);
  if (url.host !== `${SHOP}.myshopify.com`) throw new Error(`unexpected fetch to ${url.host}`);
  if (url.pathname === "/admin/oauth/access_token") {
    const p = new URLSearchParams(String(init.body));
    if (p.get("client_id") !== "test-app-id" || p.get("client_secret") !== SECRET) return json({ error: "invalid_client" }, 401);
    if (p.get("grant_type") === "refresh_token") {
      fake.refreshes++;
      await new Promise((r) => setTimeout(r, 30));
      return p.get("refresh_token") === fake.refresh ? issue() : json({ error: "invalid_grant" }, 400);
    }
    if (p.get("code") !== fake.code || p.get("expiring") !== "1") return json({ error: "invalid_request" }, 400);
    return issue();
  }
  if (url.pathname !== "/admin/api/2026-10/graphql.json") return json({ errors: "Not Found" }, 404);
  if (init.headers?.["x-shopify-access-token"] !== fake.access) return json({ errors: "[API] Invalid API key or access token" }, 401);
  const { query } = JSON.parse(init.body);
  if (/appUninstall/.test(query)) {
    fake.uninstalls.push(fake.access);
    return json({ data: { appUninstall: { app: { id: "gid://shopify/App/1" }, userErrors: [] } } });
  }
  if (/shop\s*\{\s*name/.test(query)) return json({ data: { shop: { name: "Buyer Store" } } });
  return json({ errors: [{ message: "unexpected query" }] });
};

const simDb = await importApp("lib/sim-db.ts");
const tokens = await importApp("lib/shopify-tokens.ts");
const { shopifyConfig, shopifyQuery } = await importApp("lib/shopify.ts");
const { storeAccess } = await importApp("lib/store.ts");
const connectRoute = await importApp("app/api/shopify/connect/route.ts");
const callbackRoute = await importApp("app/api/shopify/callback/route.ts");
const disconnectRoute = await importApp("app/api/shopify/disconnect/route.ts");
const statusRoute = await importApp("app/api/shopify/status/route.ts");
const webhookRoute = await importApp("app/api/shopify/webhooks/route.ts");
const db = () => simDb.getDb();

const owner = await staffSession({ role: "owner" });
const otherOwner = await staffSession({ role: "owner" });
const agent = await staffSession();

/** Start a connect as `who`; returns the state Shopify would echo and the cookie to send back */
async function begin(who = owner, shop = `${SHOP}.myshopify.com`) {
  const r = await call(connectRoute.POST, { method: "POST", url: "https://help.example.test/api/shopify/connect", body: { shop }, headers: { cookie: who.cookie } });
  assert.equal(r.status, 200, r.text);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  return { url: new URL(r.json.url), state: new URL(r.json.url).searchParams.get("state"), cookie };
}

/** Shopify's redirect back, signed the way Shopify signs it */
function signed(params, secret = SECRET) {
  const sorted = new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)));
  sorted.set("hmac", createHmac("sha256", secret).update(sorted.toString()).digest("hex"));
  return sorted;
}

async function callback(started, { who = owner, params = {}, secret, cookie = started.cookie } = {}) {
  const q = signed({ code: fake.code, host: "YWRtaW4", shop: `${SHOP}.myshopify.com`, state: started.state, timestamp: String(Math.floor(Date.now() / 1000)), ...params }, secret);
  const r = await call(callbackRoute.GET, { url: `https://help.example.test/api/shopify/callback?${q}`, headers: { cookie: `${who.cookie}; ${cookie}` } });
  assert.equal(r.status, 303);
  assert.match(r.headers.get("set-cookie"), /shopify_oauth=;.*Max-Age=0/);
  return new URL(r.headers.get("location"), "https://help.example.test").searchParams;
}

async function connect() {
  const result = await callback(await begin());
  assert.equal(result.get("shopify"), "connected", result.get("reason"));
}

const expireAccess = () => db().prepare(`UPDATE shopify_connection SET access_expires_at = ?`).run(Date.now() - 1000);
const alerts = (kind = "shopify") => db().prepare(`SELECT subject, body, dedupe_key FROM alerts WHERE kind = ? ORDER BY id`).all(kind);
const ownerNotes = () => db().prepare(`SELECT text FROM notifications WHERE user_id = ? ORDER BY id`).all(owner.user.id).map((r) => r.text);

test("status: setup URLs for the owner, read-only for agents, never keys", async () => {
  const r = await call(statusRoute.GET, { headers: { cookie: owner.cookie } });
  assert.equal(r.status, 200);
  assert.equal(r.json.canManage, true);
  assert.equal(r.json.appConfigured, true);
  assert.equal(r.json.connection, null);
  assert.deepEqual(r.json.setup, {
    appUrl: "https://help.example.test/settings",
    redirectUrl: "https://help.example.test/api/shopify/callback",
    webhookUrl: "https://help.example.test/api/shopify/webhooks",
    scopes: ["read_customers", "read_orders"],
  });
  assert.equal((await call(statusRoute.GET, { headers: { cookie: agent.cookie } })).json.canManage, false);
  assert.equal((await call(statusRoute.GET)).status, 401);
  assert.ok(!r.text.includes(SECRET));
});

test("connect: owner only, a real store address, a signed short-lived state cookie", async () => {
  const no = await call(connectRoute.POST, { method: "POST", body: { shop: SHOP }, headers: { cookie: agent.cookie } });
  assert.equal(no.status, 403);
  for (const shop of ["", "evil.com/x", "a b", null]) {
    const r = await call(connectRoute.POST, { method: "POST", body: { shop }, headers: { cookie: owner.cookie } });
    assert.equal(r.status, 400, String(shop));
  }
  const r = await call(connectRoute.POST, { method: "POST", url: "https://help.example.test/x", body: { shop: "https://Buyer-Store.myshopify.com/" }, headers: { cookie: owner.cookie } });
  const url = new URL(r.json.url);
  assert.equal(url.origin + url.pathname, `https://${SHOP}.myshopify.com/admin/oauth/authorize`);
  assert.equal(url.searchParams.get("client_id"), "test-app-id");
  assert.equal(url.searchParams.get("scope"), "read_customers,read_orders");
  assert.equal(url.searchParams.get("redirect_uri"), "https://help.example.test/api/shopify/callback");
  assert.ok(url.searchParams.get("state").length >= 32);
  assert.ok(!url.searchParams.has("grant_options[]"), "offline token, not per-user");
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /^shopify_oauth=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\/api\/shopify/);
  assert.match(cookie, /Max-Age=600/);
  assert.match(cookie, /Secure/);
});

test("the callback refuses a bad signature, a stale or foreign state, another owner, missing scopes", async () => {
  const started = await begin();
  const cases = [
    ["wrong signature", { secret: "not-the-secret" }],
    ["no cookie", { cookie: "x=1" }],
    ["state mismatch", { params: { state: "forged" } }],
    ["another store", { params: { shop: "other-store.myshopify.com" } }],
    ["not a myshopify domain", { params: { shop: "evil.example.com" } }],
    ["old timestamp", { params: { timestamp: String(Math.floor(Date.now() / 1000) - 3600) } }],
    ["another owner's browser", { who: otherOwner }],
    ["bad code", { params: { code: "nope" } }],
  ];
  for (const [label, opts] of cases) {
    const result = await callback(started, opts);
    assert.equal(result.get("shopify"), "error", label);
    assert.ok(result.get("reason"), label);
  }
  // An agent can't finish one at all
  const r = await call(callbackRoute.GET, { url: `https://help.example.test/api/shopify/callback?shop=x`, headers: { cookie: agent.cookie } });
  assert.equal(r.status, 403);

  fake.scope = "read_orders";
  const missing = await callback(await begin());
  assert.match(missing.get("reason"), /read_customers/);
  fake.scope = "write_customers,read_orders"; // write includes read
  assert.equal((await callback(await begin())).get("shopify"), "connected");
  fake.scope = "read_customers,read_orders";
  assert.equal(tokens.storedConnection().status, "connected");
  assert.equal(db().prepare(`SELECT COUNT(*) AS n FROM shopify_connection`).get().n, 1);
});

test("connecting saves encrypted keys, clears cached store data and is audited", async () => {
  const t = simDb.ingestEmail({
    customer: { sourceKey: `email:${createHash("sha256").update("ann@example.com").digest("hex")}`, firstName: "Ann", lastName: "Lee", email: "ann@example.com" },
    subject: "Where is my order?",
    body: "Order #1001",
    channel: "email",
    tags: "email",
    senderVerified: true,
    messageId: "<c1@example.com>",
    refs: [],
  });
  db().prepare(`INSERT OR REPLACE INTO store_snapshots (ticket_id, data) VALUES (?, '{}')`).run(t.ticketId);
  await connect();
  const c = tokens.storedConnection();
  assert.equal(c.shop, SHOP);
  assert.equal(c.shopName, "Buyer Store");
  assert.deepEqual(c.scopes, ["read_customers", "read_orders"]);
  assert.equal(c.connectedBy, owner.user.username);
  const row = db().prepare(`SELECT access_token, refresh_token FROM shopify_connection`).get();
  assert.ok(!row.access_token.includes(fake.access) && row.access_token.startsWith("v1."));
  assert.ok(!row.refresh_token.includes(fake.refresh));
  assert.equal(db().prepare(`SELECT COUNT(*) AS n FROM store_snapshots`).get().n, 0);
  assert.ok(db().prepare(`SELECT 1 FROM audit_log WHERE action = 'shopify_connect'`).get());
  const config = shopifyConfig();
  assert.equal(config.source, "settings");
  assert.equal(config.shop, SHOP);
  assert.equal(storeAccess(t.ticketId).ok, true);
  assert.deepEqual(await shopifyQuery(config, `query ShopName { shop { name } }`), { shop: { name: "Buyer Store" } });
  await assert.rejects(shopifyQuery(config, `mutation { appUninstall { app { id } } }`), /Only read queries/);
});

test("an expired key is refreshed once, even with several callers, and the refresh key rotates", async () => {
  await connect();
  const app = { clientId: "test-app-id", clientSecret: SECRET };
  const before = fake.access;
  assert.equal(await tokens.settingsAccessToken(app), before);
  expireAccess();
  const refreshes = fake.refreshes;
  const got = await Promise.all([tokens.settingsAccessToken(app), tokens.settingsAccessToken(app), tokens.settingsAccessToken(app)]);
  assert.equal(fake.refreshes, refreshes + 1);
  assert.deepEqual(new Set(got), new Set([fake.access]));
  assert.notEqual(fake.access, before);
  // A 401 on the current key gets a fresh one too
  const again = await tokens.settingsAccessToken(app, fake.access);
  assert.equal(fake.refreshes, refreshes + 2);
  assert.equal(again, fake.access);
});

test("a refused refresh asks the owner to reconnect, once", async () => {
  await connect();
  const app = { clientId: "test-app-id", clientSecret: SECRET };
  const before = alerts().length;
  fake.refresh = "revoked-elsewhere";
  expireAccess();
  await assert.rejects(tokens.settingsAccessToken(app), /needs reconnecting/);
  const c = tokens.storedConnection();
  assert.equal(c.status, "reconnect");
  assert.match(c.lastError, /refused/);
  assert.equal(shopifyConfig(), null);
  assert.equal(db().prepare(`SELECT access_token, refresh_token FROM shopify_connection`).get().refresh_token, null);
  await assert.rejects(tokens.settingsAccessToken(app), /needs reconnecting/);
  assert.equal(alerts().length, before + 1);
  assert.match(alerts().at(-1).subject, /Reconnect the Shopify store/);
  assert.match(ownerNotes().at(-1), /needs reconnecting/);
  const t = db().prepare(`SELECT id FROM sim_tickets LIMIT 1`).get();
  assert.match(storeAccess(t.id).reason, /needs reconnecting/);
  const status = await call(statusRoute.GET, { headers: { cookie: owner.cookie } });
  assert.equal(status.json.connection.status, "reconnect");
  // Reconnecting starts over
  await connect();
  assert.equal(tokens.storedConnection().status, "connected");
});

test("disconnect: owner only, uninstalls the app with the store's key, forgets everything", async () => {
  await connect();
  assert.equal((await call(disconnectRoute.POST, { method: "POST", headers: { cookie: agent.cookie } })).status, 403);
  const key = fake.access;
  const r = await call(disconnectRoute.POST, { method: "POST", headers: { cookie: owner.cookie } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { shop: SHOP, uninstalled: true });
  assert.deepEqual(fake.uninstalls.at(-1), key);
  assert.equal(tokens.storedConnection(), null);
  assert.equal(shopifyConfig(), null);
  assert.ok(db().prepare(`SELECT 1 FROM audit_log WHERE action = 'shopify_disconnect'`).get());
  // Nothing connected: nothing to do
  const none = await call(disconnectRoute.POST, { method: "POST", headers: { cookie: owner.cookie } });
  assert.deepEqual(none.json, { shop: null, uninstalled: false });
});

test("a store pinned in .env.local can't be changed from Settings", async () => {
  process.env.SHOPIFY_SHOP = "pinned-store";
  try {
    const r = await call(connectRoute.POST, { method: "POST", body: { shop: SHOP }, headers: { cookie: owner.cookie } });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /SHOPIFY_SHOP/);
    assert.equal((await call(disconnectRoute.POST, { method: "POST", headers: { cookie: owner.cookie } })).status, 409);
    assert.equal((await call(statusRoute.GET, { headers: { cookie: owner.cookie } })).json.pinnedShop, "pinned-store");
  } finally {
    delete process.env.SHOPIFY_SHOP;
  }
});

// --- Webhooks

let hook = 0;
function webhook(topic, payload, { secret = SECRET, id = `wh-${++hook}`, shop = `${SHOP}.myshopify.com`, triggeredAt = new Date().toISOString(), hmac } = {}) {
  const raw = JSON.stringify(payload);
  return call(webhookRoute.POST, {
    method: "POST",
    url: "https://help.example.test/api/shopify/webhooks",
    body: raw,
    headers: {
      "x-shopify-hmac-sha256": hmac ?? createHmac("sha256", secret).update(raw).digest("base64"),
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": shop,
      "x-shopify-webhook-id": id,
      "x-shopify-triggered-at": triggeredAt,
    },
  });
}

test("webhooks need Shopify's signature and answer with no data", async () => {
  assert.equal((await webhook("app/uninstalled", {}, { secret: "wrong" })).status, 401);
  assert.equal((await webhook("app/uninstalled", {}, { hmac: "" })).status, 401);
  const r = await webhook("shop/update", { name: "x" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  delete process.env.SHOPIFY_CLIENT_SECRET;
  try {
    assert.equal((await webhook("app/uninstalled", {})).status, 401);
  } finally {
    process.env.SHOPIFY_CLIENT_SECRET = SECRET;
  }
});

test("app/uninstalled forgets the store and tells the owner; old or repeated ones are ignored", async () => {
  await connect();
  const before = alerts().length;
  // Sent before this connection was made (an earlier uninstall arriving late)
  await webhook("app/uninstalled", {}, { triggeredAt: new Date(Date.now() - 3_600_000).toISOString() });
  assert.equal(tokens.storedConnection()?.status, "connected");
  // Another store's
  await webhook("app/uninstalled", {}, { shop: "someone-else.myshopify.com" });
  assert.equal(tokens.storedConnection()?.status, "connected");

  const triggeredAt = new Date(Date.now() + 1000).toISOString();
  await webhook("app/uninstalled", {}, { id: "uninstall-1", triggeredAt });
  assert.equal(tokens.storedConnection(), null);
  assert.equal(alerts().length, before + 1);
  assert.match(alerts().at(-1).subject, /removed the app/);
  assert.match(ownerNotes().at(-1), /removed the helpdesk's Shopify app/);
  // Shopify retries: the same delivery again does nothing
  await connect();
  await webhook("app/uninstalled", {}, { id: "uninstall-1", triggeredAt });
  assert.equal(tokens.storedConnection()?.status, "connected");
});

test("privacy webhooks: redact clears cached store data, a data request alerts with ticket IDs only", async () => {
  await connect();
  const email = "privacy@example.com";
  const t = simDb.ingestEmail({
    customer: { sourceKey: `email:${createHash("sha256").update(email).digest("hex")}`, firstName: "Pri", lastName: "Vacy", email },
    subject: "My order",
    body: "Hello",
    channel: "email",
    tags: "email",
    senderVerified: true,
    messageId: "<p1@example.com>",
    refs: [],
  });
  db().prepare(`INSERT OR REPLACE INTO store_snapshots (ticket_id, data) VALUES (?, '{"x":1}')`).run(t.ticketId);

  await webhook("customers/data_request", { shop_domain: `${SHOP}.myshopify.com`, customer: { id: 1, email: "Privacy@Example.com " }, data_request: { id: 99 } });
  const alert = alerts().at(-1);
  assert.match(alert.subject, /asked Shopify for their data/);
  assert.ok(alert.body.includes(t.ticketId));
  assert.ok(!alert.body.toLowerCase().includes(email) && !alert.body.includes("Hello"));

  await webhook("customers/redact", { shop_domain: `${SHOP}.myshopify.com`, customer: { id: 1, email }, orders_to_redact: [] });
  assert.equal(db().prepare(`SELECT COUNT(*) AS n FROM store_snapshots WHERE ticket_id = ?`).get(t.ticketId).n, 0);
  assert.ok(db().prepare(`SELECT 1 FROM sim_tickets WHERE id = ?`).get(t.ticketId), "the ticket stays");
  assert.ok(ownerNotes().at(-1).includes(t.ticketId));

  // Unknown customers: nothing to report
  const n = alerts().length;
  await webhook("customers/data_request", { customer: { email: "nobody@example.com" } });
  assert.equal(alerts().length, n);
});

test("shop/redact removes a disconnected store's leftovers, never a working connection", async () => {
  await connect();
  await webhook("shop/redact", { shop_domain: `${SHOP}.myshopify.com` });
  assert.equal(tokens.storedConnection()?.status, "connected");
  tokens.markReconnect(SHOP, "test");
  await webhook("shop/redact", { shop_domain: `${SHOP}.myshopify.com` });
  assert.equal(tokens.storedConnection(), null);
});
