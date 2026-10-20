#!/usr/bin/env node
// Control CLI for the helpdesk system (for people and AI agents).
//
//   npm run helpdesk -- <command> [args] [--json]
//
// Commands
//   status                          service, site, store, ticket counts and last backup
//   tickets [--sim|--history] [--q TEXT] [--limit N] [--offset N]
//   show <ticketId>                 one ticket with customer, messages, history
//   reply <ticketId> <text>         reply as the agent (simulated tickets only)
//   customer <ticketId> <text>      reply as the simulated customer
//   close <ticketId> | reopen <ticketId> | pending <ticketId>
//   similar <ticketId>              similar historical tickets
//   order <#S1001>                  a simulated order in the demo store
//   products <query> | customers <query>   search the store export
//   restart                         rebuild + restart the production service
//   logs [N]                        last N lines of the service log (default 50)
//   set-password                    set the web sign-in password (signs everyone out)
//
// Talks to the running helpdesk (SIM_HELPDESK_URL, default http://127.0.0.1:3100)
// using SIM_API_KEY from .env.local. Never prints secret values.

import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const envFile = join(root, ".env.local");
const env = {};
try {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
} catch {}
Object.assign(env, process.env);

const BASE = (env.SIM_HELPDESK_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const SITE = "https://helpdesk.teddyonfriday.com";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.match(/^--(q|limit|offset)$/));
const [command, ...rest] = positional;

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(env.SIM_API_KEY ? { authorization: `Bearer ${env.SIM_API_KEY}` } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → HTTP ${res.status}: ${body.error ?? body.raw ?? ""}`);
  return body;
}

const out = (data, text) => console.log(asJson ? JSON.stringify(data, null, 2) : text());
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const need = (value, usage) => {
  if (!value) {
    console.error(`Usage: npm run helpdesk -- ${usage}`);
    process.exit(2);
  }
  return value;
};

function ticketLine(t) {
  const who = t.customerName ?? t.customerEmail ?? "?";
  const state = t.simulated ? t.status ?? "" : t.closedAt ? "closed" : "open";
  return `${t.id.padEnd(10)} ${state.padEnd(8)} ${(t.createdAt ?? "").slice(0, 16).padEnd(17)} ${who.slice(0, 22).padEnd(23)} ${t.subject ?? "(no subject)"}`;
}

const commands = {
  async status() {
    let service = "unknown";
    try {
      service = sh("systemctl", ["is-active", "support-tickets"]);
    } catch (e) {
      service = e.stdout?.trim() || "inactive";
    }
    const site = await fetch(`${SITE}/`).then((r) => r.status).catch(() => 0);
    const [sim, hist, store] = await Promise.all([
      api("/api/helpdesk/tickets?source=sim&limit=100"),
      api("/api/helpdesk/tickets?limit=1"),
      fetch(`${BASE}/api/helpdesk/orders?name=%23S0`, {
        headers: env.SIM_API_KEY ? { authorization: `Bearer ${env.SIM_API_KEY}` } : {},
      }).then((r) => r.status),
    ]);
    const byStatus = sim.tickets.reduce((m, t) => ((m[t.status] = (m[t.status] ?? 0) + 1), m), {});
    let backup = null;
    try {
      backup = JSON.parse(readFileSync(join(root, "data/backups/last-run.json"), "utf8"));
    } catch {}
    const backupAge = backup && Math.round((Date.now() - Date.parse(backup.at)) / 3600e3);
    const data = {
      service,
      site: { url: SITE, httpStatus: site },
      store: store === 503 ? "not configured" : "connected",
      simulatedTickets: { total: sim.total, ...byStatus },
      historicalTickets: hist.total,
      model: env.CF_MODEL || "@cf/zai-org/glm-5.3-flash",
      backup: backup && { at: backup.at, upload: backup.upload },
    };
    out(data, () =>
      [
        `service      ${data.service}`,
        `site         ${SITE} (HTTP ${site})`,
        `store        ${data.store}`,
        `simulated    ${sim.total} tickets (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ") || "none"})`,
        `history      ${hist.total} tickets`,
        `model        ${data.model}`,
        `backup       ${backup ? `${backupAge < 48 ? `${backupAge}h` : `${Math.round(backupAge / 24)}d`} ago, ${{ done: "uploaded", skipped: "upload skipped (no bucket keys)" }[backup.upload] ?? "upload FAILED"}` : "none yet (npm run backup)"}`,
      ].join("\n"),
    );
  },

  async tickets() {
    const params = new URLSearchParams({
      source: argv.includes("--history") ? "history" : "sim",
      q: flag("q") ?? "",
      limit: flag("limit") ?? "20",
      offset: flag("offset") ?? "0",
    });
    const data = await api(`/api/helpdesk/tickets?${params}`);
    out(data, () =>
      [`${data.total} ${params.get("source")} tickets (showing ${data.tickets.length})`, ...data.tickets.map(ticketLine)].join("\n"),
    );
  },

  async show(id = need(rest[0], "show <ticketId>")) {
    const d = await api(`/api/helpdesk/tickets/${encodeURIComponent(id)}`);
    out(d, () => {
      const t = d.ticket;
      const c = d.customer;
      const lines = [
        `#${t.id}  ${t.subject ?? "(no subject)"}`,
        `status ${t.status ?? (t.closedAt ? "closed" : "open")} · priority ${t.priority} · intent ${t.aiIntent ?? "—"}${t.orderName ? ` · order ${t.orderName}` : ""}${t.sourceTicketId ? ` · replayed from #${t.sourceTicketId}` : ""}`,
        `customer ${c?.name ?? t.customerName ?? "?"} <${c?.email ?? t.customerEmail ?? "?"}> · $${c?.totalSpent ?? 0} over ${c?.totalOrders ?? 0} orders · ${d.stats.ticketCount} tickets`,
      ];
      if (d.messages) {
        lines.push("", ...d.messages.map((m) => `[${m.author}] ${m.createdAt}\n${m.body}\n`));
      } else {
        lines.push(`(historical ticket: ${t.customerMessages} customer / ${t.agentMessages} agent messages, no bodies in the export)`);
      }
      if (d.history.length) lines.push("other tickets:", ...d.history.slice(0, 8).map(ticketLine));
      return lines.join("\n");
    });
  },

  async reply(id = need(rest[0], "reply <ticketId> <text>")) {
    const body = need(rest.slice(1).join(" "), "reply <ticketId> <text>");
    const d = await api(`/api/helpdesk/sim/tickets/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ author: "agent", body, sender: "Agent" }),
    });
    out(d, () => `replied on ${id}; status now ${d.ticket.status}`);
  },

  async customer(id = need(rest[0], "customer <ticketId> <text>")) {
    const body = need(rest.slice(1).join(" "), "customer <ticketId> <text>");
    const d = await api(`/api/helpdesk/sim/tickets/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ author: "customer", body }),
    });
    out(d, () => `customer replied on ${id}; status now ${d.ticket.status}`);
  },

  async close(id = need(rest[0], "close <ticketId>")) {
    return setStatus(id, "closed");
  },
  async reopen(id = need(rest[0], "reopen <ticketId>")) {
    return setStatus(id, "open");
  },
  async pending(id = need(rest[0], "pending <ticketId>")) {
    return setStatus(id, "pending");
  },

  async similar(id = need(rest[0], "similar <ticketId>")) {
    const d = await api(`/api/helpdesk/tickets/${encodeURIComponent(id)}/similar?limit=8`);
    out(d, () => d.tickets.map((t) => `${String(t.similarity).padStart(3)}%  ${ticketLine(t)}`).join("\n") || "no similar tickets");
  },

  async order(name = need(rest[0], "order <#S1001>")) {
    const n = name.startsWith("#") ? name : `#${name}`;
    const d = await api(`/api/helpdesk/orders?name=${encodeURIComponent(n)}`);
    const o = d.order;
    out(d, () =>
      [
        `${o.name}  $${o.total_price}  ${o.financial_status} · ${o.fulfillment_status ?? "unfulfilled"}${o.cancelled_at ? " · CANCELLED" : ""}  (${o.created_at})`,
        ...o.line_items.map((l) => `  ${l.quantity}× ${l.title}  $${l.price}`),
        o.fulfillments.length ? `shipping: ${o.fulfillments.map((f) => `${f.tracking_company} ${f.tracking_number} (${f.status})`).join(", ")}` : "shipping: not shipped",
        o.refunds.length ? `refunds: ${o.refunds.flatMap((r) => r.transactions.map((t) => `$${t.amount}`)).join(", ")}` : null,
      ].filter(Boolean).join("\n"),
    );
  },

  async products(q = need(rest.join(" "), "products <query>")) {
    const d = await api(`/api/helpdesk/products?limit=10&q=${encodeURIComponent(q)}`);
    out(d, () => d.products.map((p) => `${p.title}  $${p.priceMin}${p.priceMax !== p.priceMin ? `–$${p.priceMax}` : ""}  stock ${p.inventory}  [${p.status}]  ${p.options ?? ""}`).join("\n") || "no products");
  },

  async customers(q = need(rest.join(" "), "customers <query>")) {
    const d = await api(`/api/helpdesk/customers?limit=10&q=${encodeURIComponent(q)}`);
    out(d, () => d.customers.map((c) => `${c.name ?? "?"} <${c.email}>  $${c.totalSpent} / ${c.totalOrders} orders  ${[c.city, c.province].filter(Boolean).join(", ")}`).join("\n") || "no customers");
  },

  async restart() {
    console.log("building…");
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
    sh("sudo", ["systemctl", "restart", "support-tickets"]);
    await new Promise((r) => setTimeout(r, 3000));
    console.log(`service ${sh("systemctl", ["is-active", "support-tickets"])}`);
  },

  async logs(n = rest[0] ?? "50") {
    console.log(sh("sudo", ["journalctl", "-u", "support-tickets", "-n", String(Number(n) || 50), "--no-pager", "-o", "cat"]));
  },

  // Web sign-in: saves only a scrypt hash of the password, plus a new SESSION_SECRET
  // (which signs everyone out). Prompts without echo, or reads one line from stdin.
  async "set-password"() {
    const password = await readSecret("New sign-in password: ");
    if (password.length < 12) {
      console.error("Use at least 12 characters.");
      process.exit(2);
    }
    if (process.stdin.isTTY && (await readSecret("Repeat it: ")) !== password) {
      console.error("The passwords don't match.");
      process.exit(2);
    }
    const salt = randomBytes(16);
    let text = "";
    try {
      text = readFileSync(envFile, "utf8");
    } catch {}
    text = setEnvLine(text, "HELPDESK_PASSWORD_HASH", `scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`);
    text = setEnvLine(text, "SESSION_SECRET", randomBytes(32).toString("base64url"));
    writeFileSync(envFile, text);
    chmodSync(envFile, 0o600); // it holds secrets: owner only
    console.log("Saved to .env.local. Apply it with: npm run helpdesk -- restart");
  },
};

function setEnvLine(text, key, value) {
  const line = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  if (line.test(text)) return text.replace(line, () => `${key}=${value}`);
  return `${text}${text && !text.endsWith("\n") ? "\n" : ""}${key}=${value}\n`;
}

function readSecret(prompt) {
  const stdin = process.stdin;
  stdin.setEncoding("utf8");
  if (!stdin.isTTY) {
    let data = "";
    stdin.on("data", (chunk) => (data += chunk));
    return new Promise((done) => stdin.on("end", () => done(data.split(/\r?\n/)[0])));
  }
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  let value = "";
  return new Promise((done) => {
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003") process.exit(130);
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return done(value);
        }
        value = ch === "\u007f" || ch === "\b" ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function setStatus(id, status) {
  const d = await api(`/api/helpdesk/sim/tickets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  out(d, () => `${id} is now ${d.ticket.status}`);
}

if (!command || !commands[command]) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 22).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(command ? 2 : 0);
}
commands[command]().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
