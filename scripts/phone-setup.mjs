#!/usr/bin/env node
// One-time page for pasting the demo store's database token from a browser.
//
//   node scripts/phone-setup.mjs <secret-path-token> [hours, default 3]
//
// Serves a single-field form at /setup-<token>/ on 127.0.0.1:3200 (Caddy proxies it).
// Checks the token by reading the shop-sim D1 database, writes it to .env.local only
// if that works, then exits. Values are never echoed back or logged.

import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envFile = join(root, ".env.local");
const DATABASE_ID = "433ed25d-4b4d-40db-beb0-ad2df6ce690c"; // D1 "shop-sim"
const token = process.argv[2];
if (!token || token.length < 32) {
  console.error("Usage: node scripts/phone-setup.mjs <token of 32+ chars> [hours]");
  process.exit(1);
}
const base = `/setup-${token}`;
const HOURS = Math.min(Math.max(Number(process.argv[3]) || 3, 0.1), 24);
const EXPIRES = Date.now() + HOURS * 3600 * 1000;

const readEnv = () => {
  const env = {};
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Helpdesk setup</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f6f7; --card:#fff; --fg:#18181b; --muted:#6b6b76; --line:#e2e2e6; --accent:#4f46e5; --ok:#15803d; --bad:#b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0e0e11; --card:#18181c; --fg:#ececf0; --muted:#9a9aa6; --line:#2c2c33; --accent:#818cf8; --ok:#4ade80; --bad:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, -apple-system, sans-serif; }
  main { max-width:520px; margin:0 auto; padding:20px 16px 40px; }
  h1 { font-size:20px; margin:4px 0; } p { margin:6px 0; }
  .muted { color:var(--muted); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-top:16px; }
  label { display:block; font-weight:600; }
  input { width:100%; font:inherit; padding:12px; margin-top:6px; border:1px solid var(--line); border-radius:8px; background:transparent; color:inherit; }
  button { width:100%; margin-top:18px; padding:14px; font:inherit; font-weight:600; border:0; border-radius:10px; background:var(--accent); color:#fff; }
  .ok { color:var(--ok); } .bad { color:var(--bad); }
</style></head><body><main>${body}</main></body></html>`;
}

function form(errors = []) {
  return page(`
<h1>Connect the demo store</h1>
<p class="muted">One-time page for helpdesk.teddyonfriday.com. Paste the token, it's checked against the store's database, saved on the server, and this page disappears.</p>
${errors.length ? `<div class="card">${errors.map((e) => `<p class="bad">✗ ${esc(e)}</p>`).join("")}<p class="muted">Nothing was saved.</p></div>` : ""}
<form class="card" method="post" action="${base}/" autocomplete="off">
  <label for="d1">Store database token</label>
  <input id="d1" name="d1" type="password" required autofocus>
  <p class="muted">The <b>helpdesk shop-sim database</b> token from the Cloudflare tab (D1: Edit, your account only).</p>
  <button type="submit">Check and save</button>
</form>`);
}

async function check(d1Token, accountId) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${DATABASE_ID}/query`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${d1Token}`, "content-type": "application/json" },
        body: JSON.stringify({ sql: "SELECT count(*) AS n FROM products" }),
      },
    );
    const body = await res.json().catch(() => null);
    if (res.ok && body?.success) return [];
    const message = body?.errors?.[0]?.message;
    return [`Cloudflare refused the token for the store database (HTTP ${res.status}${message ? `: ${message}` : ""}).`];
  } catch {
    return ["Couldn't reach the Cloudflare API."];
  }
}

function save(values) {
  const keys = Object.keys(values);
  const lines = readFileSync(envFile, "utf8")
    .split("\n")
    .filter((line) => !keys.some((k) => line.startsWith(`${k}=`)));
  while (lines.length && lines.at(-1) === "") lines.pop();
  lines.push("", "# Demo store database (D1 behind the shop-sim Worker)", ...keys.map((k) => `${k}=${values[k]}`), "");
  writeFileSync(envFile, lines.join("\n"), { mode: 0o600 });
}

let done = false;
const server = createServer(async (req, res) => {
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "no-referrer",
  };
  const path = (req.url ?? "").split("?")[0].replace(/\/$/, "");
  if (done || Date.now() > EXPIRES || path !== base) {
    res.writeHead(404, headers).end(page("<h1>Not found</h1>"));
    return;
  }
  if (req.method === "GET") {
    res.writeHead(200, headers).end(form());
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, headers).end(page("<h1>Method not allowed</h1>"));
    return;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10000) break;
  }
  const d1Token = (new URLSearchParams(raw).get("d1") ?? "").trim();
  const accountId = readEnv().CLOUDFLARE_ACCOUNT_ID;
  const errors = /^[\x21-\x7e]{20,}$/.test(d1Token) ? await check(d1Token, accountId) : ["The token looks incomplete."];
  if (errors.length) {
    console.log(`setup: rejected: ${errors[0]}`);
    res.writeHead(200, headers).end(form(errors));
    return;
  }
  save({ SHOP_SIM_ACCOUNT_ID: accountId, SHOP_D1_DATABASE_ID: DATABASE_ID, SHOP_D1_TOKEN: d1Token });
  done = true;
  console.log("setup: saved SHOP_D1_TOKEN");
  res.writeHead(200, headers).end(
    page(`<h1 class="ok">✓ Saved</h1><div class="card"><p class="ok">✓ The token can read the store database</p>
<p class="muted">You can close this page. Claude will finish the setup and run a test round with orders.</p></div>`),
  );
  setTimeout(() => server.close(() => process.exit(0)), 500);
});

server.listen(3200, "127.0.0.1", () => console.log(`setup: listening on 127.0.0.1:3200${base.slice(0, 12)}…`));
setTimeout(() => {
  console.log("setup: expired");
  process.exit(2);
}, EXPIRES - Date.now()).unref();
