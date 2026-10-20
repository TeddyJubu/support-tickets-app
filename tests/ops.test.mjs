// Operations: encrypted backups and restore checks, the ops monitor, the overview.

import { scratch, importApp, call } from "./helpers.mjs";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const simDb = await importApp("lib/sim-db.ts");
const backup = await importApp("lib/ops/backup.ts");
const monitor = await importApp("lib/ops/monitor.ts");
const overviewRoute = await importApp("app/api/overview/route.ts");
const workerState = await importApp("lib/worker/state.ts");

simDb.createSimTicket({
  customer: { sourceKey: "ops-1", firstName: "Ops", lastName: "Test", email: "ops@customers.bb-sim.test" },
  subject: "Backup me",
  body: "Please keep this safe",
});

test("no certificate: backups refuse to run unencrypted", async () => {
  await assert.rejects(() => backup.runBackup(), /backup-setup/);
});

let keys;
test("backup is encrypted, private, and verifies with the private key", async () => {
  keys = backup.setupBackupKeys();
  assert.equal(statSync(keys.key).mode & 0o777, 0o600);
  const r = await backup.runBackup();
  const file = join(backup.backupDir(), r.file);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  // Encrypted: no SQLite header or ticket text in the file
  const bytes = readFileSync(file);
  assert.ok(!bytes.includes(Buffer.from("SQLite format 3")));
  assert.ok(!bytes.includes(Buffer.from("Please keep this safe")));
  const check = backup.restoreCheck(r.file, keys.key);
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.equal(check["sim.db"].integrity, "ok");
  assert.ok(check["sim.db"].counts.sim_tickets >= 1);
  // The live database was not touched by the check
  assert.ok(existsSync(join(scratch, "sim.db")));
});

test("a damaged backup fails the check", async () => {
  const r = await backup.runBackup();
  // Flip one byte of the ciphertext: AES-GCM authentication must reject it
  const path = join(backup.backupDir(), r.file);
  const bytes = readFileSync(path);
  bytes[Math.floor(bytes.length * 0.7)] ^= 0xff;
  writeFileSync(path, bytes);
  assert.throws(() => backup.restoreCheck(r.file, keys.key));
});

test("old backups are pruned to the newest 8", async () => {
  for (let i = 0; i < 9; i++) await backup.runBackup();
  assert.equal(backup.listBackups().length, 8);
});

test("ops monitor reports each check; a missing or stale report says so", () => {
  assert.equal(monitor.lastOpsStatus().state, "missing");
  const status = monitor.writeOpsStatus();
  for (const k of ["worker", "database", "draftQueue", "disk", "backups", "knowledgeBase", "alerts"]) assert.ok(k in status.checks, k);
  assert.equal(status.checks.database.ok, true);
  assert.equal(status.checks.backups.ok, true, status.checks.backups.detail);
  assert.equal(status.checks.worker.ok, false, "no worker in tests");
  assert.ok(existsSync(join(scratch, "ops-status.json")));
  assert.equal(monitor.lastOpsStatus().state, "ok");
  new DatabaseSync(join(scratch, "sim.db")).exec(`UPDATE worker_state SET updated_at = datetime('now', '-10 minutes') WHERE key = 'ops'`);
  assert.equal(monitor.lastOpsStatus().state, "stale");
  void workerState;
});

test("overview returns every part, each on its own", async () => {
  const r = await call(overviewRoute.GET);
  for (const k of ["escalations", "workload", "ai", "activity", "learning", "ops"]) {
    assert.equal(r.json[k].ok, true, `${k}: ${r.json[k].error}`);
  }
  assert.equal(r.json.workload.data.byStatus.open >= 1, true);
});
