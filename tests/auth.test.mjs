// Staff accounts, sessions, login rate limiting and the site-wide sign-in gate.

import { scratch, importApp, call, staffSession } from "./helpers.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { NextRequest } from "next/server.js";

const auth = await importApp("lib/auth.ts");
const loginRoute = await importApp("app/api/auth/login/route.ts");
const logoutRoute = await importApp("app/api/auth/logout/route.ts");
const meRoute = await importApp("app/api/auth/me/route.ts");
const { proxy } = await importApp("proxy.ts");
const raw = new DatabaseSync(join(scratch, "sim.db"));

const PASSWORD = "a long enough password";
const owner = auth.createUser({ username: "owner", displayName: "Olive Owner", password: PASSWORD, role: "owner" });

test("passwords are salted PBKDF2 and verify", () => {
  const a = auth.hashPassword("same password here");
  const b = auth.hashPassword("same password here");
  assert.notEqual(a, b);
  assert.match(a, /^pbkdf2\$\d+\$/);
  assert.ok(auth.verifyPassword("same password here", a));
  assert.ok(!auth.verifyPassword("other password here", a));
  const stored = raw.prepare(`SELECT password_hash FROM staff_users WHERE username = 'owner'`).get().password_hash;
  assert.ok(!stored.includes(PASSWORD));
});

test("short passwords and bad usernames are refused", () => {
  assert.throws(() => auth.createUser({ username: "x", displayName: "X", password: PASSWORD }));
  assert.throws(() => auth.createUser({ username: "shorty", displayName: "S", password: "short" }));
});

test("login route sets an HttpOnly session cookie; only a hash is stored", async () => {
  const r = await call(loginRoute.POST, { method: "POST", body: { username: "OWNER", password: PASSWORD } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.username, "owner");
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /^hd_session=[\w-]{40,}; Path=\/; HttpOnly; SameSite=Lax/);
  const token = cookie.split(";")[0].split("=")[1];
  assert.equal(raw.prepare(`SELECT count(*) AS c FROM staff_sessions WHERE token_hash = ?`).get(token).c, 0);
  assert.equal(auth.sessionUser(token).username, "owner");
});

test("Secure cookie behind HTTPS (Caddy)", async () => {
  const r = await call(loginRoute.POST, {
    method: "POST",
    body: { username: "owner", password: PASSWORD },
    headers: { "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.9" },
  });
  assert.match(r.headers.get("set-cookie"), /; Secure$/);
});

test("wrong password and unknown user get the same answer", async () => {
  const a = await call(loginRoute.POST, { method: "POST", body: { username: "owner", password: "nope nope nope" }, headers: { "x-forwarded-for": "203.0.113.1" } });
  const b = await call(loginRoute.POST, { method: "POST", body: { username: "ghost", password: "nope nope nope" }, headers: { "x-forwarded-for": "203.0.113.1" } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.json.error, b.json.error);
});

test("repeated failures for one username are rate limited, even with the right password", async () => {
  auth.createUser({ username: "target", displayName: "T", password: PASSWORD });
  for (let i = 0; i < 6; i++) {
    await call(loginRoute.POST, { method: "POST", body: { username: "target", password: "wrong wrong wrong" }, headers: { "x-forwarded-for": `192.0.2.${i}` } });
  }
  const r = await call(loginRoute.POST, { method: "POST", body: { username: "target", password: PASSWORD }, headers: { "x-forwarded-for": "192.0.2.99" } });
  assert.equal(r.status, 429);
});

test("expired and idle sessions are rejected", () => {
  const { token } = auth.createSession(owner.id);
  raw.prepare(`UPDATE staff_sessions SET last_seen_at = datetime('now', '-13 hours')`).run();
  assert.equal(auth.sessionUser(token), null);
  const fresh = auth.createSession(owner.id);
  raw.prepare(`UPDATE staff_sessions SET expires_at = datetime('now', '-1 minute') WHERE token_hash != ''`).run();
  assert.equal(auth.sessionUser(fresh.token), null);
});

test("disabling a user or changing the password ends their sessions", () => {
  const u = auth.createUser({ username: "leaver", displayName: "L", password: PASSWORD });
  const s1 = auth.createSession(u.id);
  assert.ok(auth.sessionUser(s1.token));
  auth.setPassword("leaver", "a brand new password");
  assert.equal(auth.sessionUser(s1.token), null);
  const s2 = auth.createSession(u.id);
  auth.setDisabled("leaver", true);
  assert.equal(auth.sessionUser(s2.token), null);
  assert.equal(auth.login("leaver", "a brand new password", "10.0.0.1").ok, false);
});

test("logout deletes the session", async () => {
  const s = await staffSession();
  assert.ok(auth.sessionUser(s.token));
  const r = await call(logoutRoute.POST, { method: "POST", headers: { cookie: s.cookie } });
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(auth.sessionUser(s.token), null);
});

test("/api/auth/me returns the user and staff list, never password hashes", async () => {
  const s = await staffSession({ displayName: "Mia Me" });
  const r = await call(meRoute.GET, { headers: { cookie: s.cookie } });
  assert.equal(r.json.user.displayName, "Mia Me");
  assert.ok(r.json.staff.length >= 2);
  assert.ok(!r.text.includes("pbkdf2"));
  assert.equal((await call(meRoute.GET)).status, 401);
});

// ---------- proxy ----------

const run = (path, { method = "GET", headers = {} } = {}) =>
  proxy(new NextRequest(new URL(path, "http://helpdesk.test"), { method, headers: { host: "helpdesk.test", ...headers } }));

test("pages redirect to /login, APIs answer 401, without a session", () => {
  const page = run("/");
  assert.equal(page.status, 307);
  assert.equal(page.headers.get("location"), "http://helpdesk.test/login");
  const deep = run("/kb?x=1");
  assert.equal(new URL(deep.headers.get("location")).searchParams.get("next"), "/kb?x=1");
  assert.equal(run("/api/helpdesk/tickets").status, 401);
  assert.equal(run("/api/chat", { method: "POST" }).status, 401);
});

test("public paths pass", () => {
  for (const p of ["/login", "/api/auth/login", "/api/health", "/api/ready", "/api/helpdesk/inbound/ses", "/robots.txt"]) {
    assert.equal(run(p).headers.get("x-middleware-next"), "1", p);
  }
});

test("a staff session passes; cross-site writes are blocked", async () => {
  const s = await staffSession();
  assert.equal(run("/", { headers: { cookie: s.cookie } }).headers.get("x-middleware-next"), "1");
  const same = run("/api/helpdesk/sim/tickets/SIM-1/messages", { method: "POST", headers: { cookie: s.cookie, origin: "http://helpdesk.test" } });
  assert.equal(same.headers.get("x-middleware-next"), "1");
  const cross = run("/api/helpdesk/sim/tickets/SIM-1/messages", { method: "POST", headers: { cookie: s.cookie, origin: "https://evil.example" } });
  assert.equal(cross.status, 403);
  const noOrigin = run("/api/helpdesk/sim/tickets/SIM-1", { method: "PATCH", headers: { cookie: s.cookie } });
  assert.equal(noOrigin.status, 403);
  // Behind Caddy the site is https: an http:// page on the same host isn't the same origin
  const https = { cookie: s.cookie, "x-forwarded-proto": "https" };
  assert.equal(run("/api/helpdesk/sim/tickets/SIM-1/messages", { method: "POST", headers: { ...https, origin: "https://helpdesk.test" } }).headers.get("x-middleware-next"), "1");
  assert.equal(run("/api/helpdesk/sim/tickets/SIM-1/messages", { method: "POST", headers: { ...https, origin: "http://helpdesk.test" } }).status, 403);
});

test("the simulator key opens /api/helpdesk only", () => {
  const bearer = { authorization: `Bearer ${process.env.SIM_API_KEY}` };
  assert.equal(run("/api/helpdesk/tickets", { headers: bearer }).headers.get("x-middleware-next"), "1");
  assert.equal(run("/api/chat", { method: "POST", headers: bearer }).status, 401);
  assert.equal(run("/", { headers: bearer }).status, 307);
  assert.equal(run("/api/helpdesk/tickets", { headers: { authorization: "Bearer wrong" } }).status, 401);
});

test("behind Caddy the login redirect uses the public host and https", () => {
  const r = proxy(
    new NextRequest(new URL("/kb", "http://localhost:3100"), {
      headers: { host: "helpdesk.teddyonfriday.com", "x-forwarded-proto": "https" },
    }),
  );
  assert.equal(new URL(r.headers.get("location")).origin, "https://helpdesk.teddyonfriday.com");
});
