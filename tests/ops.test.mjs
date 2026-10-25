// Operations: encrypted backups and restore checks, the ops monitor, the overview.

import { scratch, importApp, call, staffSession } from "./helpers.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const simDb = await importApp("lib/sim-db.ts");
const raw = new DatabaseSync(join(scratch, "sim.db"));
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
  for (const k of ["worker", "database", "draftQueue", "disk", "backups", "offsiteBackups", "knowledgeBase", "alerts"]) assert.ok(k in status.checks, k);
  assert.equal(status.checks.database.ok, true);
  assert.equal(status.checks.backups.ok, true, status.checks.backups.detail);
  assert.equal(status.checks.worker.ok, false, "no worker in tests");
  assert.ok(existsSync(join(scratch, "ops-status.json")));
  assert.equal(monitor.lastOpsStatus().state, "ok");
  new DatabaseSync(join(scratch, "sim.db")).exec(`UPDATE worker_state SET updated_at = datetime('now', '-10 minutes') WHERE key = 'ops'`);
  assert.equal(monitor.lastOpsStatus().state, "stale");
});

test("a failed scheduled backup stops counting once a later backup succeeds", async () => {
  // Fails (as before backup-setup); then a backup made by hand afterwards
  workerState.setState("task:backup", { ok: false, error: "No backup certificate. Run: npm run helpdesk -- backup-setup" });
  const sim = new DatabaseSync(join(scratch, "sim.db"));
  sim.exec(`UPDATE worker_state SET updated_at = datetime('now', '-1 minute') WHERE key = 'task:backup'`);
  assert.equal(monitor.collectOpsStatus().checks.backups.ok, true, "the newest backup is newer than the failure");
  // A failure after the newest backup still shows
  sim.exec(`UPDATE worker_state SET updated_at = datetime('now', '+1 minute') WHERE key = 'task:backup'`);
  const check = monitor.collectOpsStatus().checks.backups;
  assert.equal(check.ok, false);
  assert.match(check.detail, /last run failed: No backup certificate/);
  workerState.setState("task:backup", { ok: true });
  sim.close();
});

test("overview returns every part, each on its own", async () => {
  const r = await call(overviewRoute.GET);
  for (const k of ["escalations", "workload", "ai", "activity", "learning", "ops"]) {
    assert.equal(r.json[k].ok, true, `${k}: ${r.json[k].error}`);
  }
  assert.equal(r.json.workload.data.byStatus.open >= 1, true);
});

test("overview gives automatic priority increases a reason and shows staff display names", async () => {
  const id = simDb.createSimTicket({
    customer: { sourceKey: "ops-priority-1", firstName: "Priority", lastName: "Test", email: "priority@customers.bb-sim.test" },
    subject: "Urgent delivery issue",
    body: "Please help",
    priority: "high",
  });
  raw.prepare(`INSERT INTO audit_log (actor, action, ticket_id, detail) VALUES ('classifier', 'triage', ?, ?)`)
    .run(id, JSON.stringify({ priority: "high", reason: "The classifier saw a legal threat." }));
  const operator = await staffSession({ displayName: "Alex Support" });
  raw.prepare(`INSERT INTO audit_log (actor, action, ticket_id, detail) VALUES (?, 'reply', ?, NULL)`)
    .run(operator.user.username, id);

  const r = await call(overviewRoute.GET);
  const escalation = r.json.escalations.data.find((row) => row.id === id);
  assert.equal(escalation.priorityReason, "The classifier saw a legal threat.");
  const activity = r.json.activity.data.find((row) => row.ticketId === id && row.action === "reply");
  assert.equal(activity.actor, "Alex Support");
});

// Off-site copies, against a local stand-in for the bucket that records every request
const bucket = { objects: new Map(), requests: [], failPuts: false };
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    bucket.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.method === "PUT") {
      if (bucket.failPuts) return res.writeHead(500).end("<Error>SlowDown</Error>");
      if (createHash("md5").update(body).digest("base64") !== req.headers["content-md5"]) return res.writeHead(400).end("BadDigest");
      bucket.objects.set(req.url, body);
      return res.writeHead(200).end();
    }
    if (req.method === "GET" && bucket.objects.has(req.url)) return res.writeHead(200).end(bucket.objects.get(req.url));
    res.writeHead(404).end();
  });
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const bucketUrl = `http://127.0.0.1:${server.address().port}/backups-bucket`;
const useBucket = () => {
  process.env.BACKUP_S3_URL = bucketUrl;
  process.env.BACKUP_S3_ACCESS_KEY_ID = "test-access-key";
  process.env.BACKUP_S3_SECRET_ACCESS_KEY = "test-secret-key";
};
const puts = () => bucket.requests.filter((r) => r.method === "PUT").map((r) => r.url.split("/").pop());

test("off-site: without bucket keys nothing leaves the server, and the monitor says so", async () => {
  const r = await backup.runBackup();
  assert.equal(r.upload, "skipped");
  assert.match(r.uploadError, /BACKUP_S3_URL/);
  assert.equal(bucket.requests.length, 0);
  const check = monitor.collectOpsStatus().checks.offsiteBackups;
  assert.equal(check.ok, false);
  assert.match(check.detail, /local only/);
});

test("off-site: every local backup is uploaded, encrypted and signed, then only new ones", async () => {
  useBucket();
  const r = await backup.runBackup();
  assert.equal(r.upload, "done", r.uploadError);
  const local = backup.listBackups().map((b) => b.file);
  assert.deepEqual(puts().sort(), [...local].sort(), "all 8 local backups, including the ones made before the keys existed");
  for (const req of bucket.requests) {
    assert.match(req.url, /^\/backups-bucket\/helpdesk\/helpdesk-.*\.tar\.gz\.cms$/);
    assert.match(req.headers.authorization, /^AWS4-HMAC-SHA256 /);
    assert.equal(req.headers["x-amz-content-sha256"], createHash("sha256").update(req.body).digest("hex"));
    assert.ok(!req.body.includes(Buffer.from("SQLite format 3")), "only ciphertext is uploaded");
    assert.ok(!req.body.includes(Buffer.from("Please keep this safe")));
  }
  assert.deepEqual(bucket.objects.get(`/backups-bucket/helpdesk/${r.file}`), readFileSync(join(backup.backupDir(), r.file)));
  assert.equal(monitor.collectOpsStatus().checks.offsiteBackups.ok, true);
  assert.equal(backup.offsiteStatus().latestUploaded, true);

  bucket.requests.length = 0;
  const next = await backup.runBackup();
  assert.deepEqual(puts(), [next.file], "already-uploaded backups are not sent again");
});

test("off-site: a failed upload keeps the backup, is reported, and is retried next time", async () => {
  bucket.requests.length = 0;
  bucket.failPuts = true;
  const failed = await backup.runBackup();
  assert.equal(failed.upload, "failed");
  assert.match(failed.uploadError, /HTTP 500/);
  assert.ok(existsSync(join(backup.backupDir(), failed.file)), "the local backup still exists");
  const check = monitor.collectOpsStatus().checks.offsiteBackups;
  assert.equal(check.ok, false);
  assert.match(check.detail, /upload failed: .*HTTP 500/);

  bucket.failPuts = false;
  bucket.requests.length = 0;
  const next = await backup.runBackup();
  assert.equal(next.upload, "done");
  assert.deepEqual(puts().sort(), [failed.file, next.file].sort());
  assert.equal(monitor.collectOpsStatus().checks.offsiteBackups.ok, true);
});

test("off-site: a backup can be downloaded for a restore, and it still verifies", async () => {
  const [newest] = backup.listBackups();
  const local = join(backup.backupDir(), newest.file);
  const original = readFileSync(local);
  writeFileSync(local, Buffer.alloc(0)); // pretend it's lost
  const path = await backup.downloadBackup(newest.file);
  assert.deepEqual(readFileSync(path), original);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(backup.restoreCheck(newest.file, keys.key).ok, true);
  await assert.rejects(() => backup.downloadBackup("../sim.db"), /Not a backup file name/);
  await assert.rejects(() => backup.downloadBackup("helpdesk-missing.tar.gz.cms"), /HTTP 404/);
  server.close();
});
