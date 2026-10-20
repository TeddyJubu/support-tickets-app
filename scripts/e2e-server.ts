// Starts the built app on a scratch data folder for the browser tests (playwright.config.ts):
// one owner account, a few inbox tickets (one with an AI draft), and a small KB. No AI, email
// or store credentials are passed on, so nothing can leave the machine.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = process.env.E2E_PORT || "3399";
const data = mkdtempSync(join(tmpdir(), "helpdesk-e2e-"));
process.env.HELPDESK_DATA_DIR = data;
process.env.HELPDESK_KB_DIR = join(data, "kb");
process.env.AUTO_DRAFTS = "0";

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

// No AI, email or store credentials: nothing can leave the machine
const env: NodeJS.ProcessEnv = { ...process.env, HELPDESK_DATA_DIR: data, HELPDESK_KB_DIR: join(data, "kb"), AUTO_DRAFTS: "0" };
for (const k of Object.keys(env)) if (/CLOUDFLARE|AWS|SHOP_|INBOUND_|ALERT_|OUTBOUND/.test(k)) delete env[k];
const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", port], {
  cwd: root,
  env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
