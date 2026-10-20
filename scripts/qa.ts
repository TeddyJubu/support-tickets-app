// Scenario harness (ported from the Shopify helpdesk's testing/qa_harness.py).
//   npm run qa                 offline: deterministic checks (triage, no-draft gate) on every
//                              scenario; fails the run on any miss. Part of npm run verify.
//   npm run qa -- --live       also runs the real drafter (Workers AI) on a scratch copy of the
//                              data and the KB, and writes testing/reports/qa-<time>.md for a
//                              person to grade A–E. Costs Workers AI calls; nothing is sent.
//   npm run qa -- --live --only S01,E07
//
// Scenarios: testing/scenarios.json (48) and testing/reliability-scenarios.json (10).

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadEnv } from "./env";

interface Scenario {
  id: string;
  cat: string;
  intent: string;
  subject: string;
  email: string;
  message: string;
  expect: string;
}

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const live = args.includes("--live");
const onlyArg = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
if (args.includes("--only") && (!onlyArg || onlyArg.startsWith("--"))) {
  console.error("--only needs scenario ids, e.g. --only S01,E07");
  process.exit(2);
}
const only = onlyArg ? onlyArg.split(",").map((x) => x.trim()) : null;

const load = (f: string) => JSON.parse(readFileSync(join(root, "testing", f), "utf8")) as Scenario[];
const allScenarios = [...load("scenarios.json"), ...load("reliability-scenarios.json")];
const unknown = (only ?? []).filter((id) => !allScenarios.some((s) => s.id === id));
if (unknown.length) {
  console.error(`Unknown scenario id(s): ${unknown.join(", ")}`);
  process.exit(2);
}
const scenarios = allScenarios.filter((s) => !only || only.includes(s.id));

// What the expectation text requires, in machine-checkable terms
function rules(s: Scenario) {
  const e = s.expect;
  return {
    mustEscalate: /Require HIGH\/CRITICAL|Critical\/high sensitive|High priority and alert|ESCALATE IMMEDIATE/i.test(e),
    // Case-sensitive: "do NOT draft" means no draft; "do not draft a reply promising…" doesn't
    mustNotDraft: /do NOT draft|No model generation|no-action/.test(e) && !/must not be suppressed/i.test(e),
    // "No-action or escalate" also accepts an urgent escalation; "No model generation" doesn't
    escalateOk: /or escalate/i.test(e),
    mustDraft: /^DRAFT|must not be suppressed/i.test(e),
    calm: /low\/normal|no staff task or owner alert/i.test(e),
  };
}

// A scratch data folder: the live drafter must never touch real data
const scratch = mkdtempSync(join(tmpdir(), "helpdesk-qa-"));
process.env.HELPDESK_DATA_DIR = scratch;
process.env.HELPDESK_KB_DIR = join(scratch, "kb");
if (live) {
  loadEnv(root);
  for (const k of Object.keys(process.env)) if (/AWS|OUTBOUND_EMAIL|INBOUND_|ALERT_|SHOP_/.test(k)) delete process.env[k];
  const data = join(root, "data");
  if (existsSync(join(data, "kb"))) cpSync(join(data, "kb"), join(scratch, "kb"), { recursive: true });
  if (existsSync(join(data, "kb.db"))) cpSync(join(data, "kb.db"), join(scratch, "kb.db"));
} else {
  for (const k of Object.keys(process.env)) if (/CLOUDFLARE|AWS|SHOP_/.test(k)) delete process.env[k];
}

const { classify } = await import("@/lib/classifier/index");
const { createSimTicket, getDb, getSimTicketDetail } = await import("@/lib/sim-db");
const { draftForJob } = await import("@/lib/drafting/run");
const { claimNextJob } = await import("@/lib/drafting/queue");
const { closeDatabases } = await import("@/lib/db");

const misses: string[] = [];
const report: string[] = [
  `# QA run ${new Date().toISOString()}`,
  "",
  `Mode: ${live ? "live drafter (Workers AI)" : "offline"}. Grade each draft A (send as is) … E (harmful). Nothing was sent.`,
  "",
];

for (const s of scenarios) {
  const r = rules(s);
  const c = classify({ subject: s.subject, message: s.message, intents: s.intent ? [s.intent] : [] });
  const urgent = c.priority === "high" || c.priority === "critical";
  const problems: string[] = [];
  if (r.mustEscalate && !(urgent && c.notifyOwner)) problems.push(`expected high/critical with owner alert, got ${c.priority}`);
  if (r.mustNotDraft && c.shouldDraft && !(urgent && r.escalateOk)) problems.push("expected no draft (nothing to answer), the gate would draft");
  if (r.mustNotDraft && !r.escalateOk && c.notifyOwner) problems.push(`expected no owner alert, got ${c.priority}`);
  if (r.mustDraft && !c.shouldDraft) problems.push("expected a draft, the gate skipped it");
  if (r.calm && c.notifyOwner) problems.push(`expected no owner alert, got ${c.priority} (${c.reason})`);
  for (const p of problems) misses.push(`${s.id}: ${p}`);

  report.push(`## ${s.id} (${s.cat}) ${problems.length ? "❌" : "✅"}`, "", `**Customer:** ${s.message}`, "", `**Expected:** ${s.expect}`, "");
  report.push(`**Triage:** ${c.priority}${c.sensitive ? ", sensitive" : ""}${c.notifyOwner ? ", owner alert" : ""}${c.shouldDraft ? "" : ", no draft"}: ${c.reason}`, "");
  if (problems.length) report.push(...problems.map((p) => `- ⚠️ ${p}`), "");

  if (live && c.shouldDraft) {
    try {
      const id = createSimTicket({
        customer: { sourceKey: `qa-${s.id}`, firstName: "Test", lastName: s.id, email: s.email },
        subject: s.subject,
        body: s.message,
        aiIntent: s.intent || null,
      });
      const job = claimNextJob(getDb(), "qa");
      if (!job || job.ticketId !== id) throw new Error("job not queued");
      const out = await draftForJob(job);
      const d = getSimTicketDetail(id)?.ai?.draft;
      report.push(`**Outcome:** ${out.state}${d ? `, ${d.action}, ${d.severity}${d.sensitive ? ", sensitive" : ""}` : ""}`);
      if (d) {
        if (d.missingFacts.length) report.push(`**Missing facts:** ${d.missingFacts.join("; ")}`);
        if (d.staffNextStep) report.push(`**Staff next step:** ${d.staffNextStep}`);
        if (d.flags.length) report.push(`**Cleaner:** ${d.flags.join("; ")}`);
        report.push(`**KB:** ${d.kbRefs.join("; ") || "none"}`, "", "```", d.body || "(no customer text: staff writes this reply)", "```");
        if (r.mustEscalate && !(d.severity === "high" || d.severity === "critical")) misses.push(`${s.id}: live draft severity ${d.severity}, expected high/critical`);
      }
      report.push("", "**Grade (A–E):** ___  **Notes:** ___", "");
    } catch (err) {
      report.push(`**Draft failed:** ${err instanceof Error ? err.message : err}`, "");
    }
  }
}

closeDatabases();
rmSync(scratch, { recursive: true, force: true });
report.splice(3, 0, `${scenarios.length} scenarios, ${misses.length} deterministic misses.`, "");
if (live) {
  const dir = join(root, "testing", "reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `qa-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(file, report.join("\n"));
  console.log(`report: ${file}`);
}
console.log(`${scenarios.length} scenarios, ${misses.length} misses`);
for (const m of misses) console.log(`  ${m}`);
process.exit(misses.length ? 1 : 0);
