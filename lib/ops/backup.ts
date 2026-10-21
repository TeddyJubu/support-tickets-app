// Encrypted backups of the helpdesk's own data: sim.db (tickets, staff, drafts, lessons…),
// kb.db and the data/kb/ articles. Every 6 hours (worker task) and on demand:
//   1. online SQLite backups into a private temp folder, plus a manifest with checksums
//   2. tar.gz, encrypted with OpenSSL CMS (AES-256-GCM) to a recipient certificate, so the
//      server holds only the public half; the private key belongs off the server
//   3. keep the newest 8 (two days), at least 3
//   4. upload every encrypted backup the bucket doesn't have yet (see "Off-site copies" below)
// helpdesk.db (the CSV export) is not included: it is rebuilt with npm run seed.

import { backup, DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { AwsClient } from "aws4fetch";
import { dataDir, schemaVersion } from "../db";
import { getDb } from "../sim-db";
import { kbDbPath } from "../kb/index";
import { kbDir } from "../kb/files";
import { getState, setState } from "../worker/state";

const KEEP = 8;
export const backupDir = () => join(dataDir(), "backups");
export const keyDir = () => join(dataDir(), "backup-keys");
export const recipientCert = () => process.env.BACKUP_RECIPIENT_CERT || join(keyDir(), "recipient.pem");

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);

export interface BackupInfo {
  file: string;
  bytes: number;
  createdAt: string;
}

export function listBackups(): BackupInfo[] {
  if (!existsSync(backupDir())) return [];
  return readdirSync(backupDir())
    .filter((f) => /^helpdesk-.*\.tar\.gz\.cms$/.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const st = statSync(join(backupDir(), f));
      return { file: f, bytes: st.size, createdAt: st.mtime.toISOString() };
    });
}

/** Creates a key pair for backups. The private key must then be moved off the server. */
export function setupBackupKeys() {
  mkdirSync(keyDir(), { recursive: true, mode: 0o700 });
  const cert = join(keyDir(), "recipient.pem");
  const key = join(keyDir(), "PRIVATE-move-off-server.pem");
  if (existsSync(cert)) throw new Error(`A backup certificate already exists: ${cert}`);
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:4096", "-nodes", "-keyout", key, "-out", cert, "-days", "3650", "-subj", "/CN=buttons-bebe-helpdesk-backup"],
    { stdio: "ignore" },
  );
  chmodSync(key, 0o600);
  return { cert, key };
}

async function snapshotDb(source: DatabaseSync, dest: string) {
  await backup(source, dest);
}

export async function runBackup() {
  const cert = recipientCert();
  if (!existsSync(cert)) throw new Error("No backup certificate. Run: npm run helpdesk -- backup-setup");
  mkdirSync(backupDir(), { recursive: true, mode: 0o700 });
  const work = mkdtempSync(join(tmpdir(), "helpdesk-backup-"));
  try {
    chmodSync(work, 0o700);
    const payload = join(work, "payload");
    mkdirSync(payload);
    await snapshotDb(getDb(), join(payload, "sim.db"));
    if (existsSync(kbDbPath())) {
      const kb = new DatabaseSync(kbDbPath(), { readOnly: true });
      await snapshotDb(kb, join(payload, "kb.db"));
      kb.close();
    }
    if (existsSync(kbDir())) cpSync(kbDir(), join(payload, "kb"), { recursive: true, filter: (src) => !src.includes("/.backups") });
    const files = readdirSync(payload).filter((f) => f.endsWith(".db"));
    const manifest = {
      createdAt: new Date().toISOString(),
      schema: schemaVersion(getDb()),
      files: Object.fromEntries(files.map((f) => [f, sha256(join(payload, f))])),
      tickets: Number((getDb().prepare(`SELECT count(*) AS c FROM sim_tickets`).get() as { c: number }).c),
    };
    writeFileSync(join(payload, "manifest.json"), JSON.stringify(manifest, null, 2));
    const archive = join(work, "backup.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", payload, "."]);
    const out = join(backupDir(), `helpdesk-${stamp()}.tar.gz.cms`);
    execFileSync("openssl", ["cms", "-encrypt", "-binary", "-aes-256-gcm", "-in", archive, "-outform", "DER", "-out", out, cert]);
    chmodSync(out, 0o600);
    // Keep the newest KEEP (never fewer than 3)
    const all = listBackups();
    for (const old of all.slice(Math.max(KEEP, 3))) rmSync(join(backupDir(), old.file), { force: true });
    const result = { file: basename(out), bytes: statSync(out).size, tickets: manifest.tickets, schema: manifest.schema };
    // A failed upload doesn't fail the backup: the ops monitor reports it, and the next run retries
    const offsite = await uploadPending();
    return { ...result, upload: offsite.upload, ...(offsite.error ? { uploadError: offsite.error } : {}) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Off-site copies: the encrypted backups are uploaded to an S3-compatible bucket (Cloudflare
// R2 or AWS S3). Only these .cms files leave the server, so the bucket (and its token) never
// holds readable customer data. Configure in .env.local:
//   BACKUP_S3_URL                 https://<account>.r2.cloudflarestorage.com/<bucket>
//   BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY   a token for that bucket only
//   BACKUP_S3_REGION              "auto" for R2 (default), else the AWS region
//   BACKUP_S3_PREFIX              object key prefix (default "helpdesk/")
// The bucket deletes old copies with its own lifecycle rule.

const BUCKET_KEYS = ["BACKUP_S3_URL", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"] as const;
const BACKUP_FILE = /^helpdesk-[\w-]+\.tar\.gz\.cms$/;
const OFFSITE_STATE = "offsite-backup";
type OffsiteState = { uploaded: string[]; error: string | null };

const missingBucketKeys = () => BUCKET_KEYS.filter((k) => !process.env[k]);

function bucket() {
  const missing = missingBucketKeys();
  if (missing.length) return { ok: false as const, missing };
  const client = new AwsClient({
    accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY!,
    region: process.env.BACKUP_S3_REGION || "auto",
    service: "s3",
  });
  const prefix = process.env.BACKUP_S3_PREFIX ?? "helpdesk/";
  const base = process.env.BACKUP_S3_URL!.replace(/\/$/, "");
  return {
    ok: true as const,
    key: (file: string) => `${prefix}${file}`,
    fetch: (file: string, init?: RequestInit) => client.fetch(`${base}/${prefix}${file}`, init),
  };
}

const errorText = (err: unknown) => {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  return `${err instanceof Error ? err.message : String(err)}${cause ? ` (${cause.code ?? cause.message})` : ""}`;
};

/** Uploads the local backups the bucket doesn't have yet, newest first. Never throws. */
export async function uploadPending(): Promise<{ upload: "done" | "skipped" | "failed"; uploaded: string[]; error?: string }> {
  const remote = bucket();
  if (!remote.ok) return { upload: "skipped", uploaded: [], error: `${remote.missing.join(", ")} not set` };
  const local = listBackups().map((b) => b.file);
  const done = new Set((getState<OffsiteState>(OFFSITE_STATE)?.value.uploaded ?? []).filter((f) => local.includes(f)));
  const uploaded: string[] = [];
  try {
    for (const file of local) {
      if (done.has(file)) continue;
      const body = readFileSync(join(backupDir(), file));
      const res = await remote.fetch(file, {
        method: "PUT",
        body: new Uint8Array(body),
        // Signed checksums: the bucket rejects a body that doesn't match
        headers: {
          "content-type": "application/pkcs7-mime",
          "content-md5": createHash("md5").update(body).digest("base64"),
          "x-amz-content-sha256": createHash("sha256").update(body).digest("hex"),
        },
      });
      if (!res.ok) throw new Error(`${remote.key(file)}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      done.add(file);
      uploaded.push(file);
    }
    setState(OFFSITE_STATE, { uploaded: [...done], error: null } satisfies OffsiteState);
    return { upload: "done", uploaded };
  } catch (err) {
    const error = errorText(err);
    setState(OFFSITE_STATE, { uploaded: [...done], error } satisfies OffsiteState);
    return { upload: "failed", uploaded, error };
  }
}

/** Whether the newest backup is in the bucket, for the ops monitor and `helpdesk status` */
export function offsiteStatus() {
  const missing = missingBucketKeys();
  const latest = listBackups()[0]?.file ?? null;
  const state = getState<OffsiteState>(OFFSITE_STATE);
  return {
    configured: missing.length === 0,
    missing,
    latest,
    latestUploaded: !!latest && !!state?.value.uploaded.includes(latest),
    error: state?.value.error ?? null,
    checkedAt: state?.updatedAt ?? null,
  };
}

/** Fetches an encrypted backup from the bucket into the backup folder, for restore-check and restores */
export async function downloadBackup(file: string) {
  if (!BACKUP_FILE.test(file)) throw new Error(`Not a backup file name: ${file}`);
  const remote = bucket();
  if (!remote.ok) throw new Error(`${remote.missing.join(", ")} not set in .env.local`);
  const res = await remote.fetch(file);
  if (!res.ok) throw new Error(`${remote.key(file)}: HTTP ${res.status}`);
  mkdirSync(backupDir(), { recursive: true, mode: 0o700 });
  const path = join(backupDir(), file);
  const tmp = `${path}.partial`;
  writeFileSync(tmp, new Uint8Array(await res.arrayBuffer()), { mode: 0o600 });
  renameSync(tmp, path);
  return path;
}

/**
 * Decrypts a backup into a throwaway folder and checks it: SQLite integrity, checksums,
 * schema version and row counts. Never touches live data.
 */
function readSchema(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return schemaVersion(db);
  } finally {
    db.close();
  }
}

export function restoreCheck(file: string, privateKey: string) {
  const path = existsSync(file) ? file : join(backupDir(), file);
  if (!existsSync(path)) throw new Error(`No such backup: ${file}`);
  if (!existsSync(privateKey)) throw new Error(`No such key: ${privateKey}`);
  const work = mkdtempSync(join(tmpdir(), "helpdesk-restore-check-"));
  try {
    chmodSync(work, 0o700);
    const archive = join(work, "backup.tar.gz");
    execFileSync("openssl", ["cms", "-decrypt", "-binary", "-inform", "DER", "-in", path, "-inkey", privateKey, "-out", archive], { stdio: ["ignore", "ignore", "pipe"] });
    const out = join(work, "restored");
    mkdirSync(out);
    execFileSync("tar", ["-xzf", archive, "-C", out]);
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as { schema: number; files: Record<string, string>; createdAt: string };
    const report: Record<string, unknown> = { backup: basename(path), createdAt: manifest.createdAt, schema: manifest.schema };
    for (const [name, sum] of Object.entries(manifest.files)) {
      const db = new DatabaseSync(join(out, name), { readOnly: true });
      const integrity = (db.prepare(`PRAGMA integrity_check`).get() as Record<string, string>).integrity_check;
      const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%fts%'`).all() as Array<{ name: string }>).map((t) => t.name);
      const counts = Object.fromEntries(tables.map((t) => [t, Number((db.prepare(`SELECT count(*) AS c FROM "${t}"`).get() as { c: number }).c)]));
      db.close();
      report[name] = { integrity, checksum: sha256(join(out, name)) === sum ? "ok" : "MISMATCH", counts };
    }
    report.kbArticles = existsSync(join(out, "kb")) ? readdirSync(join(out, "kb"), { recursive: true }).filter((f) => String(f).endsWith(".md")).length : 0;
    const sim = report["sim.db"] as { counts?: Record<string, number> } | undefined;
    const restoredSchema = sim?.counts ? readSchema(join(out, "sim.db")) : null;
    report.schemaCheck = restoredSchema === manifest.schema ? "ok" : `MISMATCH (restored ${restoredSchema}, manifest ${manifest.schema})`;
    report.ticketCheck =
      sim?.counts?.sim_tickets === (manifest as { tickets?: number }).tickets ? "ok" : `MISMATCH (restored ${sim?.counts?.sim_tickets}, manifest ${(manifest as { tickets?: number }).tickets})`;
    const ok = report.schemaCheck === "ok" && report.ticketCheck === "ok" && Object.values(report).every((v) => typeof v !== "object" || v === null || ((v as { integrity?: string }).integrity === "ok" && (v as { checksum?: string }).checksum === "ok"));
    return { ok, ...report };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
