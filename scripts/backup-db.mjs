#!/usr/bin/env node
// Backups of the helpdesk databases (data/sim.db, data/helpdesk.db).
//
//   npm run backup                          back up both DBs, upload them, prune old local copies
//   npm run backup -- --no-upload           local copies only
//   npm run backup -- verify <file.db.gz>   check a backup opens; print its row counts
//   npm run backup -- download <file.db.gz> fetch a backup from the bucket into data/backups/
//
// Each DB is copied online with VACUUM INTO (a consistent snapshot while the app is
// writing; never cp a WAL database), integrity-checked, gzipped to
// data/backups/<db>-<UTC time>.db.gz (mode 600) and uploaded to an S3-compatible
// bucket (Cloudflare R2 or AWS S3); until all three BACKUP_S3_ keys below are set,
// the upload is skipped (not a failure). Local copies older
// than --keep-days (default 14) are deleted, but the newest copy of each DB is always
// kept. The bucket expires old copies with its own lifecycle rule.
//
// Options: --data DIR (default data/), --dir DIR (default data/backups/), --keep-days N
// .env.local (values are never printed):
//   BACKUP_S3_URL                 bucket URL, e.g. https://<account>.r2.cloudflarestorage.com/<bucket>
//   BACKUP_S3_REGION              "auto" for R2 (default), else the AWS region
//   BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
//   BACKUP_S3_PREFIX              object key prefix (default "helpdesk/")

import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { AwsClient } from "aws4fetch";

const root = resolve(import.meta.dirname, "..");
const env = {};
try {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
} catch {}
Object.assign(env, process.env);

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.match(/^--(data|dir|keep-days)$/));
const [command, arg] = positional;

const dataDir = resolve(flag("data") ?? join(root, "data"));
const backupDir = resolve(flag("dir") ?? join(dataDir, "backups"));
const keepDays = Number(flag("keep-days") ?? 14);

// The table counted in the log line for each DB
const DBS = [
  { name: "sim", table: "sim_tickets" },
  { name: "helpdesk", table: "tickets" },
];
const BACKUP_NAME = /^(\w+)-(\d{8}T\d{6}Z)\.db\.gz$/;

const kb = (bytes) => (bytes < 1e6 ? `${(bytes / 1e3).toFixed(1)} KB` : `${(bytes / 1e6).toFixed(1)} MB`);

// integrity_check, then row counts for every table
function check(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const result = Object.values(db.prepare("PRAGMA integrity_check").get())[0];
    if (result !== "ok") throw new Error(`integrity_check failed for ${path}: ${result}`);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    return Object.fromEntries(
      tables.map(({ name }) => [name, db.prepare(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`).get().n]),
    );
  } finally {
    db.close();
  }
}

// { missing } until the bucket URL and both keys are set
function bucket() {
  const missing = ["BACKUP_S3_URL", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"].filter((k) => !env[k]);
  if (missing.length) return { missing };
  const client = new AwsClient({
    accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID,
    secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
    region: env.BACKUP_S3_REGION || "auto",
    service: "s3",
  });
  const prefix = env.BACKUP_S3_PREFIX ?? "helpdesk/";
  return {
    key: (file) => `${prefix}${file}`,
    fetch: (file, init) => client.fetch(`${env.BACKUP_S3_URL.replace(/\/$/, "")}/${prefix}${file}`, init),
  };
}

async function backup() {
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  for (const f of readdirSync(backupDir)) if (/\.(tmp|partial)$/.test(f)) rmSync(join(backupDir, f), { force: true });

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const made = [];
  let failed = false;
  // One DB failing doesn't stop the other
  for (const { name, table } of DBS) {
    const tmp = join(backupDir, `${name}-${stamp}.db.tmp`);
    try {
      const db = new DatabaseSync(join(dataDir, `${name}.db`), { readOnly: true });
      try {
        db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
      } finally {
        db.close();
      }
      const counts = check(tmp);
      const gz = gzipSync(readFileSync(tmp));
      const file = `${name}-${stamp}.db.gz`;
      writeFileSync(join(backupDir, `${file}.partial`), gz, { mode: 0o600 });
      renameSync(join(backupDir, `${file}.partial`), join(backupDir, file));
      made.push({ file, gz });
      console.log(`backed up ${name}.db → ${join(backupDir, file)} (${kb(gz.length)}, ${counts[table] ?? "?"} ${table})`);
    } catch (err) {
      failed = true;
      console.error(`backup of ${name}.db failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  let upload = "skipped";
  const remote = argv.includes("--no-upload") ? null : bucket();
  if (remote?.missing) {
    console.warn(`upload skipped: ${remote.missing.join(", ")} not set, so the backups stay on this machine only`);
  } else if (remote && made.length) {
    try {
      for (const { file, gz } of made) {
        const res = await remote.fetch(file, {
          method: "PUT",
          body: gz,
          // Signed checksums: the bucket rejects a body that doesn't match
          headers: {
            "content-type": "application/gzip",
            "content-md5": createHash("md5").update(gz).digest("base64"),
            "x-amz-content-sha256": createHash("sha256").update(gz).digest("hex"),
          },
        });
        if (!res.ok) throw new Error(`${remote.key(file)}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
        console.log(`uploaded ${remote.key(file)}`);
      }
      upload = "done";
    } catch (err) {
      upload = "failed";
      const cause = err?.cause?.code ?? err?.cause?.message;
      console.error(`upload failed: ${err instanceof Error ? err.message : err}${cause ? ` (${cause})` : ""}`);
    }
  }
  writeFileSync(
    join(backupDir, "last-run.json"),
    JSON.stringify({ at: new Date().toISOString(), files: made.map((m) => m.file), upload }, null, 2),
    { mode: 0o600 },
  );

  prune();
  if (failed || upload === "failed") process.exit(1);
}

// Delete local copies older than keepDays, always keeping each DB's newest
function prune() {
  const cutoff = Date.now() - keepDays * 86400e3;
  const byDb = {};
  for (const f of readdirSync(backupDir)) {
    const m = BACKUP_NAME.exec(f);
    if (m) (byDb[m[1]] ??= []).push({ f, at: Date.parse(m[2].replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3T$4:$5:$6Z")) });
  }
  let removed = 0;
  for (const list of Object.values(byDb)) {
    list.sort((a, b) => b.at - a.at);
    for (const { f, at } of list.slice(1)) {
      if (at < cutoff) {
        rmSync(join(backupDir, f));
        removed++;
      }
    }
  }
  if (removed) console.log(`pruned ${removed} local backup${removed === 1 ? "" : "s"} older than ${keepDays} days`);
}

function verify(file) {
  if (!file) throw new Error("Usage: npm run backup -- verify <file.db.gz>");
  const dir = mkdtempSync(join(tmpdir(), "backup-verify-"));
  try {
    const db = join(dir, "restore.db");
    writeFileSync(db, gunzipSync(readFileSync(file)), { mode: 0o600 });
    const counts = check(db);
    console.log(`${basename(file)}: integrity ok`);
    for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(20)} ${n}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function download(file) {
  if (!file || !BACKUP_NAME.test(file)) throw new Error("Usage: npm run backup -- download <db>-<time>.db.gz");
  const remote = bucket();
  if (remote.missing) throw new Error(`${remote.missing.join(", ")} not set in .env.local`);
  const res = await remote.fetch(file);
  if (!res.ok) throw new Error(`download of ${remote.key(file)} failed: HTTP ${res.status}`);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const dest = join(backupDir, file);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()), { mode: 0o600 });
  console.log(`downloaded ${remote.key(file)} → ${dest} (${kb(statSync(dest).size)})`);
  verify(dest);
}

try {
  if (command === "verify") verify(arg);
  else if (command === "download") await download(arg);
  else if (!command) await backup();
  else throw new Error(`Unknown command: ${command}`);
} catch (err) {
  console.error(`backup: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
