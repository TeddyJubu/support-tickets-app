// Shared SQLite access (node:sqlite) for the helpdesk's own databases in data/.
// One connection per file per process; every open applies pending migrations, so the
// web server, the worker and scripts always see the same schema.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

/** data/ by default; tests and scripts point HELPDESK_DATA_DIR at a scratch folder */
export const dataDir = () => process.env.HELPDESK_DATA_DIR || join(process.cwd(), "data");

const connections = new Map<string, DatabaseSync>();
const depth = new WeakMap<DatabaseSync, number>();

export function openDatabase(file: string, migrations: Migration[]) {
  const path = join(dataDir(), file);
  const open = connections.get(path);
  if (open) return open;
  mkdirSync(dataDir(), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`);
  migrate(db, migrations);
  connections.set(path, db);
  return db;
}

export function closeDatabases() {
  for (const db of connections.values()) db.close();
  connections.clear();
}

export function migrate(db: DatabaseSync, migrations: Migration[]) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT (datetime('now')))`);
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    // Re-checked inside the write lock: another process may have applied it meanwhile
    transaction(db, () => {
      if (db.prepare(`SELECT 1 FROM schema_version WHERE version = ?`).get(m.version)) return;
      m.up(db);
      db.prepare(`INSERT INTO schema_version (version, name) VALUES (?, ?)`).run(m.version, m.name);
    });
  }
}

export function schemaVersion(db: DatabaseSync) {
  const row = db.prepare(`SELECT max(version) AS v FROM schema_version`).get() as { v: number | null };
  return row.v ?? 0;
}

// Runs fn atomically. The outermost call takes the write lock up front (BEGIN IMMEDIATE),
// so two processes can't both read-then-write; nested calls become savepoints.
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  const savepoint = `sp_${level}`;
  db.exec(level === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    db.exec(level === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
    return result;
  } catch (err) {
    db.exec(level === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw err;
  } finally {
    depth.set(db, level);
  }
}
