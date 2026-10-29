// Who can call which /api/helpdesk route: every route and method, for a staff session, the
// simulator/CLI key (SIM_API_KEY) and nobody, checked at the proxy and again in the handler.
// A new route fails here until it's classified in ACCESS. Also: what the key sees (simulated
// tickets only, no notes, drafts or customer records), and the CLI and simulator commands run
// end to end against these handlers through a local server. Nothing here reaches the network.

import { scratch, importApp, call, staffSession, root } from "./helpers.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server.js";

// Only the local test server answers; anything else is a bug in the test or the code
const localFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const href = input instanceof Request ? input.url : String(input);
  if (new URL(href).hostname !== "127.0.0.1") throw new Error(`test: no network (${href})`);
  return localFetch(input, init);
};
process.env.INBOUND_EMAIL_TOKEN = "test-inbound-token-0123456789";

// The store export, as `npm run seed` builds it (scripts/seed.mjs), with fictional rows
const history = new DatabaseSync(join(scratch, "helpdesk.db"));
history.exec(`
  CREATE TABLE customers (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, name TEXT, email TEXT, phone TEXT, company TEXT,
    address1 TEXT, address2 TEXT, city TEXT, province TEXT, country TEXT, zip TEXT, accepts_email INTEGER, accepts_sms INTEGER,
    total_spent REAL, total_orders INTEGER, note TEXT, tags TEXT, tax_exempt INTEGER);
  CREATE TABLE products (handle TEXT PRIMARY KEY, title TEXT, vendor TEXT, category TEXT, type TEXT, tags TEXT, status TEXT,
    published INTEGER, description TEXT, image TEXT, price_min REAL, price_max REAL, compare_at_max REAL, variant_count INTEGER,
    inventory INTEGER, options TEXT, skus TEXT, final_sale INTEGER);
  CREATE TABLE tickets (id TEXT PRIMARY KEY, subject TEXT, tags TEXT, channel TEXT, priority TEXT, integration TEXT,
    created_by_agent INTEGER, created_at TEXT, closed_at TEXT, assignee_name TEXT, assignee_email TEXT, customer_email TEXT,
    customer_name TEXT, first_response_s INTEGER, resolution_s INTEGER, agent_messages INTEGER, customer_messages INTEGER,
    url TEXT, ai_intent TEXT, contact_reason TEXT, product TEXT, resolution TEXT, sentiment TEXT, customer_type TEXT, automated INTEGER);
  CREATE VIRTUAL TABLE customers_fts USING fts5(id UNINDEXED, name, email, phone, city, company, tags, tokenize='unicode61');
  CREATE VIRTUAL TABLE products_fts USING fts5(handle UNINDEXED, title, type, category, tags, options, skus, description, tokenize='porter unicode61');
  CREATE VIRTUAL TABLE tickets_fts USING fts5(id UNINDEXED, subject, customer_name, customer_email, tags, ai_intent, tokenize='porter unicode61');
`);
for (const [id, first, last, email] of [["c1", "Rina", "Cohen", "rina.cohen@example.test"], ["c2", "Dov", "Klein", "dov.klein@example.test"]]) {
  history.prepare(`INSERT INTO customers (id, first_name, last_name, name, email, city, province, country, total_spent, total_orders) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, first, last, `${first} ${last}`, email, "Brooklyn", "NY", "US", 240, 3);
  history.prepare(`INSERT INTO customers_fts VALUES (?,?,?,?,?,?,?)`).run(id, `${first} ${last}`, email, "", "Brooklyn", "", "");
}
history.prepare(`INSERT INTO products (handle, title, type, status, published, price_min, price_max, variant_count, inventory, options, final_sale) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  .run("tulle-dress-pink", "Pink Tulle Dress", "Dress", "active", 1, 89, 89, 3, 5, "Size: 2T, 3T, 4T", 0);
history.prepare(`INSERT INTO products_fts VALUES (?,?,?,?,?,?,?,?)`).run("tulle-dress-pink", "Pink Tulle Dress", "Dress", "", "", "Size: 2T, 3T, 4T", "", "");
for (const [id, subject, email, name] of [["9001", "Tulle dress runs small?", "rina.cohen@example.test", "Rina Cohen"], ["9002", "Tulle dress sizing", "dov.klein@example.test", "Dov Klein"]]) {
  history.prepare(`INSERT INTO tickets (id, subject, priority, created_at, customer_email, customer_name, agent_messages, customer_messages, ai_intent, automated)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, subject, "normal", "2025-03-01 10:00:00", email, name, 1, 1, "Product::Sizing", 0);
  history.prepare(`INSERT INTO tickets_fts VALUES (?,?,?,?,?,?)`).run(id, subject, name, email, "", "Product::Sizing");
}
history.close();

const simDb = await importApp("lib/sim-db.ts");
const { proxy } = await importApp("proxy.ts");
const simTickets = await importApp("app/api/helpdesk/sim/tickets/route.ts");
const messages = await importApp("app/api/helpdesk/sim/tickets/[id]/messages/route.ts");
const awaiting = await importApp("app/api/helpdesk/sim/awaiting/route.ts");
const ticketsRoute = await importApp("app/api/helpdesk/tickets/route.ts");

const sha = (v) => createHash("sha256").update(v).digest("hex");
const key = { authorization: `Bearer ${process.env.SIM_API_KEY}` };
const staff = await staffSession({ displayName: "Dana Agent" });
const asStaff = { cookie: staff.cookie };

let n = 0;
const simulated = (extra = {}) =>
  simDb.createSimTicket({
    customer: { sourceKey: `route-sim-${++n}`, firstName: "Ava", lastName: "Stein", email: `ava.${n}@customers.bb-sim.test` },
    subject: "Does the tulle dress run small?",
    body: "Hi, does the tulle dress run small?",
    sourceTicketId: "9001",
    ...extra,
  });
const emailed = () => {
  const from = `real.${++n}@example.com`;
  return simDb.ingestEmail({
    customer: { sourceKey: `email:${sha(from)}`, firstName: "Real", lastName: "Person", email: from },
    subject: `Where is my order ${n}?`,
    body: "Where is my order?",
    channel: "email",
    tags: "email",
    senderVerified: true,
    messageId: `<route-${n}@example.com>`,
    refs: [],
  }).ticketId;
};
const thread = (id) => simDb.getSimTicketDetail(id).messages.map((m) => `${m.author}: ${m.body}`);
const pending = (id) => simDb.getDb().prepare(`UPDATE sim_tickets SET status = 'pending' WHERE id = ?`).run(id);

const SIM_ID = simulated();

// ------------------------------------------------------------------ who may call what

// staff: a signed-in agent. key: the simulator/CLI bearer key. "in" = let through (the handler
// answers with data or an input error); 401 = refused. Nobody gets 401 from every handler, and
// from the proxy too except for the public SES webhook.
const STAFF_ONLY = { staff: "in", key: 401 };
const SIMULATOR_ONLY = { staff: 401, key: "in" };
const ACCESS = {
  "GET /api/helpdesk/attachments/[id]": STAFF_ONLY,
  "GET /api/helpdesk/customers": STAFF_ONLY,
  "PATCH /api/helpdesk/drafts/[id]": STAFF_ONLY,
  "POST /api/helpdesk/drafts/[id]/rewrite": STAFF_ONLY,
  // Public at the proxy; the handler wants its own token from everyone
  "POST /api/helpdesk/inbound/ses": { staff: 401, key: 401, public: true },
  "GET /api/helpdesk/orders": STAFF_ONLY,
  "GET /api/helpdesk/products": STAFF_ONLY,
  "GET /api/helpdesk/send-access": STAFF_ONLY,
  "POST /api/helpdesk/send-access": STAFF_ONLY,
  "GET /api/helpdesk/sim/awaiting": SIMULATOR_ONLY,
  "POST /api/helpdesk/sim/tickets": SIMULATOR_ONLY,
  "PATCH /api/helpdesk/sim/tickets/[id]": STAFF_ONLY,
  "GET /api/helpdesk/sim/tickets/[id]/draft": STAFF_ONLY,
  "POST /api/helpdesk/sim/tickets/[id]/draft": STAFF_ONLY,
  // Staff write notes; the key writes the simulated conversation
  "POST /api/helpdesk/sim/tickets/[id]/messages": { staff: "in", key: "in" },
  "POST /api/helpdesk/sim/tickets/bulk": STAFF_ONLY,
  "GET /api/helpdesk/tags": STAFF_ONLY,
  "GET /api/helpdesk/tickets": STAFF_ONLY,
  "POST /api/helpdesk/tickets": STAFF_ONLY,
  "GET /api/helpdesk/tickets/[id]": STAFF_ONLY,
  "GET /api/helpdesk/tickets/[id]/send": STAFF_ONLY,
  "POST /api/helpdesk/tickets/[id]/send": STAFF_ONLY,
  "POST /api/helpdesk/tickets/[id]/send/resolve": STAFF_ONLY,
  "POST /api/helpdesk/tickets/[id]/send/review": STAFF_ONLY,
  "GET /api/helpdesk/tickets/[id]/similar": STAFF_ONLY,
  "GET /api/helpdesk/tickets/[id]/store": STAFF_ONLY,
};

const apiDir = fileURLToPath(new URL("app/api", root));
function routeFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routeFiles(p) : name === "route.ts" ? [p] : [];
  });
}
const routePath = (file) => `/api/${relative(apiDir, dirname(file)).split(sep).join("/")}`;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const helpdeskRoutes = [];
for (const file of routeFiles(join(apiDir, "helpdesk"))) {
  const mod = await importApp(relative(fileURLToPath(root), file));
  for (const method of METHODS.filter((m) => typeof mod[m] === "function")) {
    helpdeskRoutes.push({ name: `${method} ${routePath(file)}`, method, path: routePath(file), handler: mod[method] });
  }
}

const idFor = (path) => (/attachments|drafts/.test(path) ? "1" : SIM_ID);
const concrete = (path) => path.replace("[id]", idFor(path));
const viaProxy = (method, path, headers) =>
  proxy(new NextRequest(new URL(concrete(path), "http://helpdesk.test"), { method, headers: { host: "helpdesk.test", ...headers } }));
const letThrough = (res) => res.headers.get("x-middleware-next") === "1";
const callHandler = (route, headers) =>
  call(route.handler, {
    method: route.method,
    url: `http://helpdesk.test${concrete(route.path)}`,
    headers,
    params: route.path.includes("[id]") ? { id: idFor(route.path) } : {},
    body: route.method === "GET" ? undefined : {},
  });

test("every /api/helpdesk route and method is classified in ACCESS", () => {
  assert.ok(helpdeskRoutes.length >= 25, `found ${helpdeskRoutes.length}`);
  assert.deepEqual(helpdeskRoutes.map((r) => r.name).sort(), Object.keys(ACCESS).sort(), "add new routes to ACCESS (and only let the key into simulator endpoints)");
});

test("nobody: the proxy and every handler refuse (the SES webhook wants its token)", async () => {
  for (const route of helpdeskRoutes) {
    const gate = viaProxy(route.method, route.path, { origin: "http://helpdesk.test" });
    if (ACCESS[route.name]?.public) assert.ok(letThrough(gate), route.name);
    else assert.equal(gate.status, 401, `proxy: ${route.name}`);
    assert.equal((await callHandler(route, {})).status, 401, `handler: ${route.name}`);
  }
});

test("the simulator/CLI key: the proxy and the handler both stop it outside the simulator's endpoints", async () => {
  for (const route of helpdeskRoutes) {
    const want = ACCESS[route.name];
    const gate = viaProxy(route.method, route.path, key);
    const res = await callHandler(route, key);
    if (want.key === "in") {
      assert.ok(letThrough(gate), `proxy: ${route.name}`);
      assert.notEqual(res.status, 401, `handler: ${route.name} ${res.text}`);
    } else {
      if (!want.public) assert.equal(gate.status, 401, `proxy: ${route.name}`);
      // Even if the proxy let it through, the handler refuses on its own
      assert.equal(res.status, 401, `handler: ${route.name}`);
    }
  }
});

test("a staff session: every staff route lets the person in; simulator-only routes don't", async () => {
  for (const route of helpdeskRoutes) {
    const want = ACCESS[route.name];
    assert.ok(letThrough(viaProxy(route.method, route.path, { ...asStaff, origin: "http://helpdesk.test" })), `proxy: ${route.name}`);
    const res = await callHandler(route, asStaff);
    if (want.staff === "in") assert.notEqual(res.status, 401, `handler: ${route.name} ${res.text}`);
    else assert.equal(res.status, 401, `handler: ${route.name}`);
  }
});

// ------------------------------------------------------------------ what the key sees and writes

const post = (id, headers, body) => call(messages.POST, { method: "POST", params: { id }, headers, body });
const VIEW_KEYS = ["customer", "messages", "ticket"];

test("the key sees a simulated ticket's thread only: no notes, drafts, customer record or history", async () => {
  const opened = await call(simTickets.POST, {
    method: "POST",
    headers: key,
    body: { customer: { sourceKey: "route-view-1", firstName: "Noa", lastName: "Gold", email: "noa@customers.bb-sim.test", phone: "+1 555-0100" }, subject: "Sizes", body: "Which size for a 3 year old?" },
  });
  assert.equal(opened.status, 201, opened.text);
  const id = opened.json.ticket.id;
  assert.deepEqual(Object.keys(opened.json).sort(), VIEW_KEYS);
  assert.deepEqual(opened.json.customer, { firstName: "Noa", name: "Noa Gold" });

  assert.equal((await post(id, asStaff, { author: "note", body: "Internal: offer a discount" })).status, 201);
  const replied = await post(id, key, { author: "agent", body: "Size 3T fits most 3 year olds." });
  assert.equal(replied.status, 201, replied.text);
  assert.deepEqual(Object.keys(replied.json).sort(), VIEW_KEYS);
  assert.equal(replied.json.ticket.status, "pending");
  assert.deepEqual(replied.json.messages.map((m) => m.author), ["customer", "agent"]);

  const waiting = await call(awaiting.GET, { url: "http://t/api/helpdesk/sim/awaiting", headers: key });
  assert.equal(waiting.status, 200);
  const mine = waiting.json.tickets.find((t) => t.ticket.id === id);
  assert.deepEqual(mine.messages.map((m) => m.author), ["customer", "agent"]);
  assert.doesNotMatch(waiting.text, /Internal: offer a discount|"ai"|"pendingSend"|"history"|555-0100/);
  for (const t of waiting.json.tickets) {
    assert.deepEqual(Object.keys(t).sort(), VIEW_KEYS);
    assert.equal(t.ticket.channel, "simulator");
  }
  // Staff still get the whole ticket from the notes route
  const note = await post(id, asStaff, { author: "note", body: "Second note" });
  assert.ok(note.json.ai && note.json.history, "staff detail");
});

test("the key can't write on a real customer's or a staff-opened ticket, and can't write notes", async () => {
  const email = emailed();
  const opened = await call(ticketsRoute.POST, { method: "POST", headers: asStaff, body: { email: "new.customer@example.com", subject: "Your order" } });
  assert.equal(opened.status, 201, opened.text);
  // Simulator channel but filed under a real sender's key: not the simulator's to answer either
  const misfiled = simulated({ customer: { sourceKey: `email:${sha("misfiled@example.com")}`, firstName: "Real", lastName: "Sender", email: "misfiled@example.com" } });
  for (const id of [email, opened.json.ticket.id, misfiled]) {
    const before = thread(id);
    for (const author of ["customer", "agent"]) {
      const r = await post(id, key, { author, body: "Written by the key" });
      assert.equal(r.status, 404, `${author} on ${id}: ${r.text}`);
      assert.doesNotMatch(r.text, /Where is my order|example\.com/);
    }
    assert.deepEqual(thread(id), before, id);
    // Waiting on the customer or not, the simulator never sees them
    pending(id);
  }
  const listed = (await call(awaiting.GET, { url: "http://t/api/helpdesk/sim/awaiting?limit=100", headers: key })).json.tickets.map((t) => t.ticket.id);
  for (const id of [email, opened.json.ticket.id, misfiled]) assert.ok(!listed.includes(id), id);

  // On a simulated ticket: customer and agent yes, a note never (notes are signed by a person)
  const sim = simulated();
  assert.equal((await post(sim, key, { author: "customer", body: "Hello again" })).status, 201);
  assert.equal((await post(sim, key, { author: "note", body: "x" })).status, 401);
  assert.equal((await post("SIM-999999", key, { author: "customer", body: "x" })).status, 404);
  // Staff can't write as the customer, or reply around review
  assert.equal((await post(sim, asStaff, { author: "customer", body: "x" })).status, 401);
  assert.equal((await post(sim, asStaff, { author: "agent", body: "x" })).status, 409);
  assert.deepEqual(thread(sim), ["customer: Hi, does the tulle dress run small?", "customer: Hello again"]);
});

// ------------------------------------------------------------------ CLI and simulator, end to end

// The proxy and the route handlers behind a local HTTP server, as `next start` serves them
const apiRoutes = routeFiles(apiDir)
  .map((file) => {
    const segs = relative(apiDir, dirname(file)).split(sep);
    return { file: relative(fileURLToPath(root), file), dynamic: segs.filter((s) => s.startsWith("[")).length, pattern: new RegExp(`^/api/${segs.map((s) => (s.startsWith("[") ? "(?<id>[^/]+)" : s)).join("/")}$`) };
  })
  .sort((a, b) => a.dynamic - b.dynamic);
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const headers = new Headers(Object.entries(req.headers).filter(([, v]) => typeof v === "string"));
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  let out = proxy(new NextRequest(url, { method: req.method, headers }));
  if (letThrough(out)) {
    const route = apiRoutes.find((r) => r.pattern.test(url.pathname));
    const handler = route && (await importApp(route.file))[req.method];
    out = handler
      ? await handler(new Request(url, { method: req.method, headers, body }), { params: Promise.resolve(route.pattern.exec(url.pathname).groups ?? {}) })
      : new Response(url.pathname.startsWith("/api/") ? "no such route" : "page", { status: url.pathname.startsWith("/api/") ? 404 : 200 });
  }
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
});
let base;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

// Loaded into each child: the local server only, and a canned Workers AI reply for the simulator
const GUARD = `data:text/javascript,${encodeURIComponent(`
  const local = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "127.0.0.1") return local(input, init);
    if (url.hostname === "api.cloudflare.com" && url.pathname.endsWith("/ai/v1/chat/completions")) {
      return Response.json({ choices: [{ message: { content: "Thanks, that helps. Ava" } }] });
    }
    throw new Error("test: no network (" + url.hostname + ")");
  };
`)}`;
const registerTs = new URL("scripts/register-ts.mjs", root).href;

/** Runs a script the way its npm command does; resolves { code, stdout, stderr, json } */
function run(script, args, { cwd = fileURLToPath(root), env = {} } = {}) {
  // Real values in a checkout's .env.local never apply: these are set, so loadEnv skips them
  const blank = Object.fromEntries(["SHOPIFY_SHOP", "SHOPIFY_ADMIN_TOKEN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "CF_MODEL"].map((k) => [k, ""]));
  const childEnv = {
    ...process.env,
    ...blank,
    SIM_HELPDESK_URL: base,
    HELPDESK_PUBLIC_URL: base,
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_API_TOKEN: "test-token",
    ...env,
  };
  const argv = ["--no-warnings", "--import", registerTs, "--import", GUARD, fileURLToPath(new URL(script, root)), ...args];
  return new Promise((resolve) => {
    execFile(process.execPath, argv, { cwd, env: childEnv, timeout: 60_000 }, (err, stdout, stderr) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {}
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr, json });
    });
  });
}
const cli = (args, opts) => run("scripts/helpdesk.mjs", args, opts);
// Read commands use the databases, not the key: a wrong key changes nothing
const noKey = { env: { SIM_API_KEY: "test-wrong-key-for-reads-0123456789" } };

test("CLI read commands work from the databases, without the key", async () => {
  const sim = simulated();
  const [status, inbox, archive, show, showOld, similar, products, customers] = await Promise.all([
    cli(["status", "--json"], noKey),
    cli(["tickets", "--q", "tulle", "--json"], noKey),
    cli(["tickets", "--history", "--json"], noKey),
    cli(["show", sim, "--json"], noKey),
    cli(["show", "9001"], noKey),
    cli(["similar", sim, "--json"], noKey),
    cli(["products", "tulle", "--json"], noKey),
    cli(["customers", "cohen"], noKey),
  ]);
  for (const r of [status, inbox, archive, show, showOld, similar, products, customers]) assert.equal(r.code, 0, r.stderr);
  assert.equal(status.json.inboxTickets.total, simDb.listSimTickets({ limit: 1 }).total);
  assert.equal(status.json.inboxTickets.email, simDb.listSimTickets({ limit: 1, channel: "email" }).total);
  assert.equal(status.json.historicalTickets, 2);
  assert.equal(status.json.ready, true);
  assert.ok(inbox.json.tickets.some((t) => t.id === sim));
  assert.deepEqual(archive.json.tickets.map((t) => t.id).sort(), ["9001", "9002"]);
  assert.equal(show.json.ticket.id, sim);
  assert.equal(show.json.messages[0].body, "Hi, does the tulle dress run small?");
  assert.match(showOld.stdout, /#9001 {2}Tulle dress runs small\?[\s\S]*Rina Cohen <rina\.cohen@example\.test>/);
  assert.deepEqual(similar.json.tickets.map((t) => t.id), ["9002"]);
  assert.equal(products.json.products[0].handle, "tulle-dress-pink");
  assert.match(customers.stdout, /Rina Cohen <rina\.cohen@example\.test> {2}\$240 \/ 3 orders {2}Brooklyn, NY/);
  assert.equal((await cli(["show", "SIM-999999"], noKey)).code, 1);
});

test("CLI reply and customer go through the key, on simulated tickets only; close/reopen/pending triage any inbox ticket", async () => {
  const sim = simulated();
  const email = emailed();
  const reply = await cli(["reply", sim, "It runs true to size."]);
  assert.equal(reply.code, 0, reply.stderr);
  assert.match(reply.stdout, new RegExp(`replied on ${sim}; status now pending`));
  const customer = await cli(["customer", sim, "Great, thank you!"]);
  assert.equal(customer.code, 0, customer.stderr);
  assert.match(customer.stdout, /status now open/);
  assert.deepEqual(thread(sim).slice(1), ["agent: It runs true to size.", "customer: Great, thank you!"]);

  for (const cmd of ["reply", "customer"]) {
    const r = await cli([cmd, email, "Written from the CLI"]);
    assert.equal(r.code, 1, `${cmd} on an email ticket`);
    assert.match(r.stderr, /HTTP 404: No simulated ticket/);
  }
  assert.equal(thread(email).length, 1);

  for (const [cmd, status] of [["close", "closed"], ["pending", "pending"], ["reopen", "open"]]) {
    const r = await cli([cmd, sim], noKey);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), `${sim} is now ${status}`);
    assert.equal(simDb.getSimTicketDetail(sim).ticket.status, status);
  }
  assert.equal((await cli(["close", email, "--json"], noKey)).json.ticket.status, "closed");
  const audit = simDb.getDb().prepare(`SELECT actor FROM audit_log WHERE action = 'triage' AND ticket_id = ? ORDER BY id DESC LIMIT 1`).get(email);
  assert.equal(audit.actor, "cli");
  const historical = await cli(["close", "9001"], noKey);
  assert.equal(historical.code, 1);
  assert.match(historical.stderr, /no inbox ticket 9001/);
});

test("the simulator opens tickets, answers follow-ups on simulated tickets only, and resets", async () => {
  const before = simDb.listSimTickets({ limit: 1, channel: "simulator" }).total;
  const dry = await run("scripts/simulate.mjs", ["--count", "1", "--dry-run"]);
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /"sourceTicketId": "900[12]"/);
  assert.equal(simDb.listSimTickets({ limit: 1, channel: "simulator" }).total, before, "a dry run writes nothing");

  const opened = await run("scripts/simulate.mjs", ["--count", "1"]);
  assert.equal(opened.code, 0, opened.stderr);
  const id = /\+ (SIM-\d+)/.exec(opened.stdout)?.[1];
  assert.ok(id, opened.stdout);
  const detail = simDb.getSimTicketDetail(id);
  assert.equal(detail.ticket.channel, "simulator");
  assert.match(detail.ticket.sourceTicketId, /^900[12]$/);
  assert.match(detail.customer.email, /@customers\.bb-sim\.test$/, "a pseudonym, never the real address");

  // Agent answered both; the simulator answers only for its own customer
  const email = emailed();
  assert.equal((await cli(["reply", id, "Size 3T, it runs true."])).code, 0);
  pending(email);
  const followUps = await run("scripts/simulate.mjs", ["--follow-ups"]);
  assert.equal(followUps.code, 0, followUps.stderr);
  assert.match(followUps.stdout, new RegExp(`~ ${id} `));
  assert.ok(!followUps.stdout.includes(email));
  assert.equal(thread(id).at(-1), "customer: Thanks, that helps. Ava");
  assert.equal(thread(email).length, 1);

  // Scenarios open through the same key, from the working directory's scenario list
  const cwd = mkdtempSync(join(tmpdir(), "helpdesk-scenarios-"));
  mkdirSync(join(cwd, "data/scenarios"), { recursive: true });
  writeFileSync(join(cwd, "data/scenarios/email-scenarios.json"), JSON.stringify([{ id: "sc-1", category: "sizing", subject: "Between sizes", body: "My son is between 3T and 4T.", customer_name: "Lea Marks" }]));
  const scenario = await run("scripts/scenarios.mjs", ["--count", "1"], { cwd });
  assert.equal(scenario.code, 0, scenario.stderr);
  const scenarioId = JSON.parse(readFileSync(join(cwd, "data/scenarios/opened.json"), "utf8"))["sc-1"].ticketId;
  assert.equal(simDb.getSimTicketDetail(scenarioId).ticket.channel, "simulator");

  const reset = await run("scripts/simulate.mjs", ["--reset"]);
  assert.equal(reset.code, 0, reset.stderr);
  assert.equal(simDb.listSimTickets({ limit: 1, channel: "simulator" }).total, 0);
  assert.equal(thread(email).length, 1, "email tickets stay");
});
