// Copilot tools (app/components/ticketing-tools.tsx) never claim an action that didn't happen.
// They read data, display what the model wrote, or change the ticket through the real, audited
// triage and note APIs. Replies go out only through the review dialog (lib/sending.ts).

import { root, importApp } from "./helpers.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("app/components/ticketing-tools.tsx", root), "utf8");
const settings = await importApp("lib/settings.ts");

const READ_OR_DISPLAY = [
  "get_customer_profile",
  "get_customer_context",
  "find_similar_tickets",
  "search_knowledge_base",
  "search_products",
  "search_customers",
  "search_tickets",
  "get_order_details",
  "generate_summary",
  "detect_sentiment",
  "analyze_customer_risk",
  "draft_response",
];
// Pause for staff approval. suggest_resolution only records a plan; escalate_ticket writes.
const NEEDS_APPROVAL = ["suggest_resolution", "escalate_ticket"];
// Template tools with no backend, removed for claiming offers and callbacks that never happened
const REMOVED = ["calculate_compensation", "schedule_callback"];

// The source of one tool, from its key to the next tool's
function toolSource(name) {
  const start = source.indexOf(`    ${name}: tool({`);
  assert.ok(start >= 0, `${name} is registered`);
  const next = source.slice(start + 1).search(/^ {4}\w+: tool\(\{/m);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

test("the copilot registers only known tools; only the reviewed ones pause for approval", () => {
  const names = [...source.matchAll(/^ {4}(\w+): tool\(\{/gm)].map((m) => m[1]);
  // A new tool that changes anything must go through a real, audited API: review it, then list it here
  assert.deepEqual([...names].sort(), [...READ_OR_DISPLAY, ...NEEDS_APPROVAL].sort());
  const approving = names.filter((n) => /needsApproval:\s*true/.test(toolSource(n)));
  assert.deepEqual(approving.sort(), [...NEEDS_APPROVAL].sort());
});

test("escalation writes through triage and notes; a resolution plan says nothing was done", () => {
  const escalate = toolSource("escalate_ticket");
  assert.match(escalate, /dashboard\.updateTicket\(/, "assigns and raises priority via the triage PATCH");
  assert.match(escalate, /dashboard\.addNote\(/, "saves the reason as an internal note");
  assert.match(toolSource("suggest_resolution"), /Nothing has been done yet/);
});

test("no tool result or prompt claims an offer, callback or other action that didn't happen", () => {
  assert.doesNotMatch(source, /\b(SENT|SCHEDULED|COMPLETED|APPLIED)\b/);
  const prompt = settings.copilotPrompt();
  for (const name of REMOVED) {
    assert.ok(!source.includes(name), `${name} is gone from the tools`);
    assert.ok(!prompt.includes(name), `${name} is not offered in the copilot prompt`);
  }
});
