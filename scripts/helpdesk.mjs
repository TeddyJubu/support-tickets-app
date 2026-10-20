#!/usr/bin/env node
// Control CLI for the helpdesk system (for people and AI agents).
//
//   npm run helpdesk -- <command> [args] [--json]
//
// Commands
//   status                          service, site, store and ticket counts
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
//   worker                          worker heartbeat, draft queue and scheduled tasks
//   ops                             latest ops monitor report (services, queue, disk, backups, KB)
//   backup-setup                    create the backup key pair (then move the private key off the server)
//   backup | backups                make an encrypted backup now | list backups
//   restore-check <file> --key <private key>   decrypt and verify a backup in a temp folder
//   user list                       staff accounts
//   user add <username> [--name "Full Name"] [--email E] [--owner]   asks for the password
//   user password <username>        set a new password (signs the user out everywhere)
//   user disable|enable <username>
//
// Talks to the running helpdesk (SIM_HELPDESK_URL, default http://127.0.0.1:3100)
// using SIM_API_KEY from .env.local. Never prints secret values.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const env = {};
try {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
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
const positional = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.match(/^--(q|limit|offset|name|email|key)$/));
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
    const ready = await fetch(`${BASE}/api/ready`).then((r) => r.json()).catch(() => null);
    const [sim, hist, store] = await Promise.all([
      api("/api/helpdesk/tickets?source=sim&limit=100"),
      api("/api/helpdesk/tickets?limit=1"),
      fetch(`${BASE}/api/helpdesk/orders?name=%23S0`).then((r) => r.status),
    ]);
    const byStatus = sim.tickets.reduce((m, t) => ((m[t.status] = (m[t.status] ?? 0) + 1), m), {});
    const data = {
      service,
      ready: ready ? ready.ready : null,
      checks: ready?.checks ?? null,
      site: { url: SITE, httpStatus: site },
      store: store === 503 ? "not configured" : "connected",
      simulatedTickets: { total: sim.total, ...byStatus },
      historicalTickets: hist.total,
      model: env.CF_MODEL || "@cf/zai-org/glm-5.3-flash",
    };
    out(data, () =>
      [
        `service      ${data.service}`,
        `ready        ${ready ? (ready.ready ? "yes" : "NO") : "unknown"}${ready ? `  (${Object.entries(ready.checks).map(([k, c]) => `${k} ${c.ok ? "ok" : `FAIL${c.detail ? `: ${c.detail}` : ""}`}`).join(", ")})` : ""}`,
        `site         ${SITE} (HTTP ${site})`,
        `store        ${data.store}`,
        `simulated    ${sim.total} tickets (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ") || "none"})`,
        `history      ${hist.total} tickets`,
        `model        ${data.model}`,
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
    // The worker runs the same code: restart it too when it's installed
    let worker = false;
    try {
      worker = sh("systemctl", ["is-enabled", "support-tickets-worker"]) === "enabled";
    } catch {}
    if (worker) sh("sudo", ["systemctl", "restart", "support-tickets-worker"]);
    await new Promise((r) => setTimeout(r, 3000));
    console.log(`service ${sh("systemctl", ["is-active", "support-tickets"])}`);
    if (worker) console.log(`worker  ${sh("systemctl", ["is-active", "support-tickets-worker"])}`);
  },

  async ops() {
    const { collectOpsStatus } = await import("../lib/ops/monitor.ts");
    const status = collectOpsStatus();
    out(status, () =>
      [`overall  ${status.ok ? "ok" : "NEEDS ATTENTION"}`, ...Object.entries(status.checks).map(([k, c]) => `${c.ok ? "ok  " : "FAIL"}     ${k.padEnd(14)} ${c.detail}`)].join("\n"),
    );
  },

  async "backup-setup"() {
    const { setupBackupKeys } = await import("../lib/ops/backup.ts");
    const { cert, key } = setupBackupKeys();
    console.log(`certificate (stays on the server): ${cert}`);
    console.log(`PRIVATE KEY: ${key}`);
    console.log("Copy the private key somewhere safe off this server (password manager, laptop), then delete it here:");
    console.log(`  shred -u ${key}`);
    console.log("Without it, backups can't be decrypted. With it on the server, anyone with server access can read them.");
  },

  async backup() {
    const { runBackup } = await import("../lib/ops/backup.ts");
    const r = await runBackup();
    out(r, () => `backup ${r.file} (${Math.round(r.bytes / 1024)} KB, ${r.tickets} tickets, schema ${r.schema})`);
  },

  async backups() {
    const { listBackups } = await import("../lib/ops/backup.ts");
    const list = listBackups();
    out(list, () => list.map((b) => `${b.createdAt}  ${String(Math.round(b.bytes / 1024)).padStart(6)} KB  ${b.file}`).join("\n") || "no backups yet");
  },

  async "restore-check"(file = need(rest[0], "restore-check <file> --key <private key>")) {
    const { restoreCheck } = await import("../lib/ops/backup.ts");
    const r = restoreCheck(file, need(flag("key"), "restore-check <file> --key <private key>"));
    out(r, () => JSON.stringify(r, null, 2));
    if (!r.ok) process.exitCode = 1;
  },

  // Reads the database directly (server only)
  async worker() {
    const { workerHealth } = await import("../lib/worker/state.ts");
    const { queueStats } = await import("../lib/drafting/queue.ts");
    const { listTasks } = await import("../lib/worker/schedule.ts");
    const { getDb } = await import("../lib/sim-db.ts");
    const health = workerHealth();
    const queue = queueStats(getDb());
    const tasks = listTasks().map((t) => ({ name: t.name, schedule: t.everyMinutes ? `every ${t.everyMinutes} min` : `daily ${t.dailyAtUtc} UTC`, last: t.last }));
    out({ health, queue, tasks }, () =>
      [
        `worker   ${health.alive ? "alive" : "NOT RUNNING"}${health.ageSeconds != null ? ` (heartbeat ${health.ageSeconds}s ago)` : ""}${health.heartbeat?.current ? `, drafting ${health.heartbeat.current.ticketId}` : ""}`,
        `queue    ${Object.entries(queue).filter(([k]) => k !== "oldestWaiting").map(([k, v]) => `${v} ${k}`).join(", ") || "empty"}${queue.oldestWaiting ? `; oldest waiting since ${queue.oldestWaiting}` : ""}`,
        ...tasks.map((t) => `task     ${t.name.padEnd(16)} ${t.schedule.padEnd(18)} ${t.last ? `${t.last.value.ok ? "ok" : `FAILED: ${t.last.value.error}`} at ${t.last.updatedAt}` : "not run yet"}`),
      ].join("\n"),
    );
  },

  // Staff accounts live in data/sim.db; these act on the database directly (server only)
  async user() {
    const auth = await import("../lib/auth.ts");
    const [action, username] = rest;
    if (action === "list") {
      const users = auth.listUsers();
      return out(users, () =>
        users.map((u) => `${u.username.padEnd(16)} ${u.role.padEnd(6)} ${u.disabled ? "disabled" : "active  "} ${u.displayName}${u.email ? ` <${u.email}>` : ""}`).join("\n") || "no staff accounts yet",
      );
    }
    need(username, "user add|password|disable|enable <username>");
    if (action === "add") {
      const password = await askPassword(`Password for ${username} (12+ characters): `);
      const user = auth.createUser({
        username,
        displayName: flag("name") ?? username,
        email: flag("email") ?? null,
        role: argv.includes("--owner") ? "owner" : "agent",
        password,
      });
      auth.audit("cli", "user_add", null, { username: user.username, role: user.role });
      return out(user, () => `created ${user.role} ${user.username} (${user.displayName})`);
    }
    if (action === "password") {
      const ok = auth.setPassword(username, await askPassword(`New password for ${username}: `));
      if (!ok) throw new Error(`no user ${username}`);
      auth.audit("cli", "user_password", null, { username });
      return out({ ok }, () => `password changed; ${username} is signed out everywhere`);
    }
    if (action === "disable" || action === "enable") {
      if (!auth.setDisabled(username, action === "disable")) throw new Error(`no user ${username}`);
      auth.audit("cli", `user_${action}`, null, { username });
      return out({ ok: true }, () => `${username} ${action}d`);
    }
    need(null, "user list|add|password|disable|enable");
  },

  async logs(n = rest[0] ?? "50") {
    console.log(sh("sudo", ["journalctl", "-u", "support-tickets", "-n", String(Number(n) || 50), "--no-pager", "-o", "cat"]));
  },
};

// Hidden prompt on a terminal; otherwise the first line of stdin (for scripts)
async function askPassword(prompt) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    let data = "";
    for await (const chunk of stdin) data += chunk;
    return data.split(/\r?\n/)[0];
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        stdin.setRawMode(false);
        reject(new Error("cancelled"));
      } else if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1);
      } else {
        value += ch;
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
  const lines = readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(command ? 2 : 0);
}
commands[command]().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
