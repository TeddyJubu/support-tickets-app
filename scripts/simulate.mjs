#!/usr/bin/env node
// Customer simulator: replays historical tickets as pseudonymous customers.
//
//   npm run simulate -- --count 5          open 5 new tickets
//   npm run simulate -- --follow-ups       answer agent replies that are waiting on the customer
//   npm run simulate -- --loop             keep going: new tickets + follow-ups every --interval seconds
//   npm run simulate -- --reset            delete all simulated tickets and customers
//
// Options:
//   --count N        tickets per round (default 3)
//   --interval S     seconds between loop rounds (default 120)
//   --rounds N       stop the loop after N rounds (default: run until Ctrl+C)
//   --intent TEXT    only replay tickets whose AI intent contains TEXT (e.g. "Return", "Damaged")
//   --dry-run        print what would be sent without writing anything
//
// Reads .env.local: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CF_MODEL (Workers AI),
// SIM_API_KEY, SIM_HELPDESK_URL (default http://127.0.0.1:3100).
//
// Simulated customers have no orders: the store is the real Shopify store, which the
// simulator never writes to, and the helpdesk shows no store data for simulated tickets.
//
// Privacy: real customer identities never leave this machine. Each customer gets
// a stable fake name and an address on the reserved .test domain; only ticket
// subject/intent/tags and the fake persona are sent to the model.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "..");

// ------------------------------------------------------------------ config
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

const { values: args } = parseArgs({
  options: {
    count: { type: "string", default: "3" },
    interval: { type: "string", default: "120" },
    rounds: { type: "string" },
    intent: { type: "string" },
    loop: { type: "boolean", default: false },
    "follow-ups": { type: "boolean", default: false },
    reset: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const HELPDESK = (env.SIM_HELPDESK_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const MODEL = env.CF_MODEL || "@cf/zai-org/glm-5.3-flash";
const dryRun = args["dry-run"];

for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "SIM_API_KEY"]) {
  if (!env[key]) {
    console.error(`Missing ${key} in .env.local`);
    process.exit(1);
  }
}

const history = new DatabaseSync(join(root, "data/helpdesk.db"), { readOnly: true });

// ------------------------------------------------------------- pseudonyms
const FIRST = ["Ava", "Mia", "Leah", "Noa", "Sara", "Tova", "Rina", "Dina", "Esti", "Gila", "Hana", "Ilana",
  "Lea", "Maya", "Nava", "Orly", "Rivka", "Shira", "Talia", "Yael", "Ella", "Chloe", "Grace", "Hazel",
  "Ivy", "Julia", "Kate", "Lily", "Nora", "Ruby", "Sophie", "Zoe", "Ben", "Dan", "Eli", "Josh", "Levi",
  "Max", "Noah", "Sam"];
const LAST = ["Abrams", "Becker", "Cohen", "Diamond", "Elkin", "Feld", "Gold", "Hart", "Isaacs", "Jacobs",
  "Klein", "Lowe", "Marks", "Nadel", "Orbach", "Pearl", "Reiss", "Stein", "Tamir", "Unger", "Vogel",
  "Weiss", "Yarden", "Zeller", "Baker", "Carter", "Dalton", "Ellis", "Foster", "Greene", "Hayes",
  "Irving", "Jensen", "Keller", "Lawson", "Monroe", "Nolan", "Porter", "Quinn", "Reed"];

function pseudonym(realEmail, realCustomer) {
  const hash = createHash("sha256").update(`bb-sim:${realEmail.toLowerCase()}`).digest("hex");
  const first = FIRST[parseInt(hash.slice(0, 8), 16) % FIRST.length];
  const last = LAST[parseInt(hash.slice(8, 16), 16) % LAST.length];
  return {
    sourceKey: hash,
    firstName: first,
    lastName: last,
    email: `${first}.${last}.${hash.slice(16, 20)}@customers.bb-sim.test`.toLowerCase(),
    phone: `+1 555-01${String(parseInt(hash.slice(20, 24), 16) % 100).padStart(2, "0")}`,
    // Region only: no street, city or zip
    province: realCustomer?.province ?? null,
    country: realCustomer?.country ?? null,
    totalSpent: realCustomer?.total_spent ?? 0,
    totalOrders: realCustomer?.total_orders ?? 0,
  };
}

// ---------------------------------------------------------------- helpers
async function http(url, init = {}, label = url) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const helpdesk = (path, init = {}) =>
  http(`${HELPDESK}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.SIM_API_KEY}`,
      "content-type": "application/json",
      ...init.headers,
    },
  }, `helpdesk ${path}`);

async function llm(system, user) {
  const data = await http(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        temperature: 0.9,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    },
    "Workers AI",
  );
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Workers AI returned no text");
  return text.replace(/^["']|["']$/g, "");
}

const intentLabel = (intent) =>
  (intent ?? "").split("::").filter((p) => p && p !== "Other").join(" / ") || "general question";

// Historical order numbers in subjects are dropped (simulated customers have no orders)
function rewriteSubject(subject, intent) {
  const core = (subject ?? "")
    .replace(/^((re|fwd?|fw)\s*:\s*)+/i, "")
    .replace(/\s*#?\s*\b\d{6,}\b/g, "")
    .trim();
  // Empty or form-generated subjects: describe the request instead
  const hadOrderNumber = /\b\d{6,}\b/.test(subject ?? "");
  if (
    core.length < 4 ||
    /^new customer message/i.test(core) ||
    hadOrderNumber // can't reference a real order number
  ) {
    return intentLabel(intent);
  }
  return (subject || "Question about my order")
    .replace(/\s*#?\s*\b\d{6,}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,:!?])/g, "$1")
    .trim();
}

// Gorgias housekeeping tags say nothing about the customer's problem
const meaningfulTags = (tags) =>
  (tags ?? "").split(",").map((t) => t.trim()).filter((t) => t && !/^auto-close$/i.test(t)).join(", ");

// ---------------------------------------------------------------- tickets
function sourceTickets(count) {
  const where = [
    "t.automated = 0",
    "t.customer_messages > 0",
    "t.subject IS NOT NULL",
    "t.customer_email IS NOT NULL",
    // Real support requests only: from an actual store customer, with a non-"Other" intent
    "c.id IS NOT NULL",
    "t.ai_intent IS NOT NULL",
    "t.ai_intent NOT LIKE 'Other::%'",
  ];
  const params = [];
  if (args.intent) {
    where.push("lower(t.ai_intent) LIKE ?");
    params.push(`%${args.intent.toLowerCase()}%`);
  }
  return history
    .prepare(
      `SELECT t.*, c.total_spent, c.total_orders, c.province, c.country
       FROM tickets t JOIN customers c ON c.email = t.customer_email
       WHERE ${where.join(" AND ")} ORDER BY random() LIMIT ?`,
    )
    .all(...params, count);
}

const PERSONA_SYSTEM = `You role-play a customer of Buttons Bebe, an online children's clothing store, writing an email to its support team.
Write ONLY the email body: no subject line, no markdown, no placeholders like [name]. 2-6 sentences, natural and specific, the way a real parent writes from their phone. Sign with your first name.`;

async function openTicket(src, runId) {
  const persona = pseudonym(src.customer_email, src);
  const subject = rewriteSubject(src.subject, src.ai_intent);
  const prompt = [
    `You are ${persona.firstName} ${persona.lastName}.`,
    `You've spent about $${Math.round(persona.totalSpent)} over ${persona.totalOrders} orders with the store.`,
    `Email subject: "${subject}"`,
    `What the email is about (support's classification): ${intentLabel(src.ai_intent)}.`,
    meaningfulTags(src.tags) ? `Tags support later added: ${meaningfulTags(src.tags)}.` : null,
    src.priority && src.priority !== "normal" ? `It was marked ${src.priority} priority, so you're upset.` : null,
    "Don't mention an order number.",
    "Write your first email to support.",
  ].filter(Boolean).join("\n");

  const body = dryRun ? `(dry run) ${prompt}` : await llm(PERSONA_SYSTEM, prompt);
  const payload = {
    customer: persona,
    subject,
    body,
    priority: src.priority ?? "normal",
    tags: src.tags,
    aiIntent: src.ai_intent,
    sourceTicketId: String(src.id),
    runId,
  };
  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return null;
  }
  const detail = await helpdesk("/api/helpdesk/sim/tickets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  console.log(
    `+ ${detail.ticket.id}  ${persona.firstName} ${persona.lastName}  "${subject}"  [from #${src.id}]`,
  );
  return detail;
}

const FOLLOW_UP_SYSTEM = `You role-play a customer of Buttons Bebe, an online children's clothing store, continuing an email thread with support.
Write ONLY your next email body: no subject, no markdown, 1-4 sentences, signed with your first name.
React realistically to the agent's last reply: if it solved your problem, thank them briefly; if it was vague, asked for something, or didn't answer, respond to that (provide plausible details, push back politely, or ask again). Never invent new unrelated problems.`;

async function followUp(detail) {
  const persona = detail.customer;
  const thread = detail.messages
    .map((m) => `${m.author === "customer" ? "YOU" : "SUPPORT"}: ${m.body}`)
    .join("\n\n");
  const prompt = [
    `You are ${persona?.firstName ?? "the customer"}.`,
    `Subject: "${detail.ticket.subject}"`,
    detail.ticket.orderName ? `Your order: ${detail.ticket.orderName}.` : null,
    `Thread so far:\n${thread}`,
    "Write your reply to support's last message.",
  ].filter(Boolean).join("\n");
  const body = dryRun ? `(dry run follow-up)` : await llm(FOLLOW_UP_SYSTEM, prompt);
  if (dryRun) {
    console.log(`~ would reply on ${detail.ticket.id}`);
    return;
  }
  await helpdesk(`/api/helpdesk/sim/tickets/${detail.ticket.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ author: "customer", body, sender: persona?.name }),
  });
  console.log(`~ ${detail.ticket.id}  ${persona?.name} replied`);
}

async function runFollowUps() {
  const { tickets } = await helpdesk("/api/helpdesk/sim/awaiting?limit=20");
  if (!tickets.length) console.log("  (no tickets waiting on the customer)");
  for (const detail of tickets) {
    try {
      await followUp(detail);
    } catch (err) {
      console.warn(`  ! follow-up on ${detail.ticket.id} failed: ${err.message}`);
    }
  }
}

async function runNewTickets(count, runId) {
  for (const src of sourceTickets(count)) {
    try {
      await openTicket(src, runId);
    } catch (err) {
      console.warn(`  ! ticket from #${src.id} failed: ${err.message}`);
    }
  }
}

// -------------------------------------------------------------------- main
async function main() {
  if (args.reset) {
    const sim = new DatabaseSync(join(root, "data/sim.db"));
    // Rows that reference tickets, messages or customers go first (foreign keys are enforced)
    const dependents = [
      "attachments", "drafts", "jobs", "ticket_tags", "ticket_reads", "sim_email_ids", "sim_email_outbox",
      "store_snapshots", "sim_returns", "lessons", "send_reviews", "notifications",
    ];
    const exists = (t) => sim.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    sim.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    for (const t of dependents) if (exists(t)) sim.exec(`DELETE FROM ${t}`);
    sim.exec("DELETE FROM sim_messages; DELETE FROM sim_tickets; DELETE FROM sim_customers; DELETE FROM sqlite_sequence WHERE name = 'sim_tickets'; COMMIT");
    sim.close();
    console.log("Deleted all simulated tickets and customers.");
    return;
  }

  const count = Math.max(1, Number(args.count) || 3);
  const runId = randomUUID().slice(0, 8);
  console.log(
    `Simulator run ${runId} → ${HELPDESK} · model ${MODEL}${dryRun ? " · DRY RUN" : ""}`,
  );

  if (!args.loop) {
    if (args["follow-ups"]) await runFollowUps();
    else await runNewTickets(count, runId);
    return;
  }

  const interval = Math.max(10, Number(args.interval) || 120) * 1000;
  const rounds = args.rounds ? Number(args.rounds) : Infinity;
  for (let round = 1; round <= rounds; round++) {
    console.log(`\n— round ${round} (${new Date().toLocaleTimeString()})`);
    await runFollowUps();
    await runNewTickets(count, runId);
    if (round < rounds) await new Promise((r) => setTimeout(r, interval));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
