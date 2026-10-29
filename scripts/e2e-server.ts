// Starts the built app on a scratch data folder for the browser tests (playwright.config.ts):
// one owner account, a few inbox tickets (one with an AI draft), and a small KB. This process
// and the server keep only the test allow-list of variables (scripts/test-env.ts), and the
// server can't load .env.local either, so no AI, email, store or backup credential is there
// to reach a live service.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nextStartEnv, scrubEnv } from "./test-env";

const root = resolve(import.meta.dirname, "..");
const port = process.env.E2E_PORT || "3399";
const data = mkdtempSync(join(tmpdir(), "helpdesk-e2e-"));
const vars = { HELPDESK_DATA_DIR: data, HELPDESK_KB_DIR: join(data, "kb"), AUTO_DRAFTS: "0" };
scrubEnv();
Object.assign(process.env, vars);

const { createUser } = await import("@/lib/auth");
const { createSimTicket, getDb } = await import("@/lib/sim-db");
const { rebuildIndex } = await import("@/lib/kb/index");

createUser({ username: "e2e-owner", displayName: "Erin Owner", password: "e2e-password-123456", role: "owner" });
createUser({ username: "e2e-agent", displayName: "Alex Agent", password: "e2e-password-123456" });

const customer = (n: number, first: string) => ({ sourceKey: `e2e-${n}`, firstName: first, lastName: "Test", email: `${first.toLowerCase()}@customers.bb-sim.test` });
const a = createSimTicket({ customer: customer(1, "Maya"), subject: "Shipping time", body: "How long does shipping take to New Jersey?" });
createSimTicket({ customer: customer(2, "Noa"), subject: "Sizing question", body: "Does the tulle dress run small?" });
createSimTicket({ customer: customer(3, "Lea"), subject: "Gift wrap", body: "Do you gift wrap orders?" });
getDb()
  .prepare(
    `INSERT INTO drafts (ticket_id, message_id, body, action, kb_refs)
     SELECT ?, max(id), 'Hi Maya,\n\nOrders ship within 24 to 48 hours, then USPS takes about 7 to 14 days.\n\nButtons Bebe Support', 'reply', '["Shipping Policy"]'
     FROM sim_messages WHERE ticket_id = ?`,
  )
  .run(a, a);

mkdirSync(join(data, "kb", "policies"), { recursive: true });
writeFileSync(
  join(data, "kb", "policies", "shipping-policy.md"),
  "---\ntitle: Shipping Policy\ncategory: policies\ntags: [shipping]\n---\n\n## Processing time\n\nOrders ship within 24 to 48 hours.\n",
);
await rebuildIndex("e2e");

// Allow-listed variables only, and none from the project's .env files (nextStartEnv)
const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", port], {
  cwd: root,
  env: nextStartEnv(root, { ...vars, NEXT_TELEMETRY_DISABLED: "1" }),
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
