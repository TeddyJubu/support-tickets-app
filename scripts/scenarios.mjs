#!/usr/bin/env node
// Scenario tickets: opens prepared customer emails (data/scenarios/email-scenarios.json) as
// simulated tickets, a batch at a time, so staff can test the inbox on hard cases.
//
//   npm run scenarios                  open the next 10 scenarios
//   npm run scenarios -- --count 5     open the next 5
//   npm run scenarios -- --list        show progress and the next batch, open nothing
//   npm run scenarios -- --dry-run     print the next batch's payloads, open nothing
//
// Opened scenarios are remembered in data/scenarios/opened.json, so each one opens once.
// Tickets are simulated (no store data, replies are never emailed). Reads SIM_API_KEY and
// SIM_HELPDESK_URL (default http://127.0.0.1:3100) from .env.local in the working directory.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const root = process.cwd();
const dir = join(root, "data/scenarios");
const listFile = join(dir, "email-scenarios.json");
const openedFile = join(dir, "opened.json");

const { values: args } = parseArgs({
  options: {
    count: { type: "string", default: "10" },
    list: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

function loadEnv(file) {
  const env = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return env;
}
const env = { ...loadEnv(join(root, ".env.local")), ...process.env };
const HELPDESK = (env.SIM_HELPDESK_URL || "http://127.0.0.1:3100").replace(/\/$/, "");

if (!existsSync(listFile)) {
  console.error(`No scenario list at ${listFile} (run from the project folder)`);
  process.exit(1);
}
const scenarios = JSON.parse(readFileSync(listFile, "utf8"));
const opened = existsSync(openedFile) ? JSON.parse(readFileSync(openedFile, "utf8")) : {};
const pending = scenarios.filter((s) => !opened[s.id]);
const batch = pending.slice(0, Math.max(1, Number(args.count) || 10));

console.log(`${scenarios.length - pending.length} of ${scenarios.length} scenarios opened, ${pending.length} left`);
if (args.list) {
  for (const s of batch) console.log(`  next ${s.id}  [${s.category}]  "${s.subject}"`);
  process.exit(0);
}
if (!batch.length) process.exit(0);
if (!env.SIM_API_KEY) {
  console.error("Missing SIM_API_KEY in .env.local");
  process.exit(1);
}

// Fictional customer on the simulator's reserved .test domain, stable per scenario
function customer(s) {
  const hash = createHash("sha256").update(`bb-scenario:${s.id}`).digest("hex");
  const [first, ...rest] = s.customer_name.trim().split(/\s+/);
  const last = rest.join(" ") || "Customer";
  const local = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
  return {
    // Hash first: the helpdesk keys customers by the first 12 characters
    sourceKey: `${hash.slice(0, 24)}-scenario`,
    firstName: first,
    lastName: last,
    email: `${local}.${hash.slice(0, 4)}@customers.bb-sim.test`,
  };
}

const runId = randomUUID();
for (const s of batch) {
  const payload = {
    customer: customer(s),
    subject: s.subject,
    body: s.body,
    priority: "normal",
    tags: "scenario",
    aiIntent: s.intent || null,
    sourceTicketId: s.seed_ref || null,
    runId,
  };
  if (args["dry-run"]) {
    console.log(JSON.stringify(payload, null, 2));
    continue;
  }
  const res = await fetch(`${HELPDESK}/api/helpdesk/sim/tickets`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.SIM_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`! ${s.id}: HTTP ${res.status} ${text.slice(0, 200)}`);
    continue;
  }
  const ticketId = JSON.parse(text).ticket.id;
  opened[s.id] = { ticketId, at: new Date().toISOString() };
  writeFileSync(openedFile, JSON.stringify(opened, null, 2));
  console.log(`+ ${ticketId}  ${s.id}  [${s.category}]  "${s.subject}"`);
}
