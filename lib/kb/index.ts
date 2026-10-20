// Builds the KB search index (data/kb.db): documents, "## " chunks, an FTS5 keyword index,
// and Workers AI embeddings for meaning-based search. A rebuild writes a new file, checks
// it, then swaps it in with a rename; if anything fails, the last good index stays.

import { DatabaseSync } from "node:sqlite";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db";
import { embed } from "../workers-ai";
import { chunkArticle, listArticles } from "./files";

export const kbDbPath = () => join(dataDir(), "kb.db");
const statusPath = () => join(dataDir(), "kb-index-status.json");
const lockPath = () => join(dataDir(), "kb-index.lock");
const STALE_LOCK_MS = 10 * 60_000;

export interface IndexStatus {
  state: "idle" | "running" | "failed";
  startedAt?: string;
  finishedAt?: string;
  docs?: number;
  chunks?: number;
  /** false: keyword search only (Workers AI not configured) */
  embeddings?: boolean;
  error?: string;
  reason?: string;
}

export function indexStatus(): IndexStatus {
  try {
    const status = JSON.parse(readFileSync(statusPath(), "utf8")) as IndexStatus;
    // A crashed build leaves "running" behind; report it as failed once the lock is stale
    if (status.state === "running" && !lockHeld()) return { ...status, state: "failed", error: "Index build stopped unexpectedly" };
    return status;
  } catch {
    return { state: "idle" };
  }
}

function writeStatus(status: IndexStatus) {
  mkdirSync(dataDir(), { recursive: true });
  const tmp = `${statusPath()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(status, null, 2));
  renameSync(tmp, statusPath());
}

function lockHeld() {
  try {
    return Date.now() - statSync(lockPath()).mtimeMs < STALE_LOCK_MS;
  } catch {
    return false;
  }
}

function acquireLock() {
  mkdirSync(dataDir(), { recursive: true });
  if (existsSync(lockPath()) && !lockHeld()) rmSync(lockPath(), { force: true });
  try {
    closeSync(openSync(lockPath(), "wx"));
    return true;
  } catch {
    return false;
  }
}

const toBlob = (v: number[]) => Buffer.from(new Float32Array(v).buffer);

/** Rebuild the index. Resolves with the final status; never throws. */
export async function rebuildIndex(reason = "manual"): Promise<IndexStatus> {
  if (!acquireLock()) return { ...indexStatus(), state: "running" };
  const startedAt = new Date().toISOString();
  writeStatus({ state: "running", startedAt, reason });
  const building = `${kbDbPath()}.building-${process.pid}`;
  try {
    const articles = listArticles();
    if (!articles.length) throw new Error("The knowledge base is empty: nothing to index");
    const rows = articles.flatMap((a) =>
      chunkArticle(a).map((c) => ({ article: a, heading: c.heading, text: c.text })),
    );
    if (!rows.length) throw new Error("No article has any text");
    const vectors = await embed(rows.map((r) => [r.article.title, r.heading, r.text].filter(Boolean).join("\n")));

    rmSync(building, { force: true });
    const db = new DatabaseSync(building);
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE docs (path TEXT PRIMARY KEY, folder TEXT, title TEXT, tags TEXT, sensitive INTEGER, status TEXT);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY, path TEXT REFERENCES docs(path), heading TEXT, text TEXT, embedding BLOB);
      CREATE VIRTUAL TABLE chunks_fts USING fts5(title, heading, text, tokenize = 'unicode61 remove_diacritics 2');
    `);
    db.exec("BEGIN");
    const doc = db.prepare(`INSERT INTO docs VALUES (?, ?, ?, ?, ?, ?)`);
    for (const a of articles) doc.run(a.path, a.folder, a.title, a.tags.join(","), a.sensitive ? 1 : 0, a.status);
    const chunk = db.prepare(`INSERT INTO chunks (id, path, heading, text, embedding) VALUES (?, ?, ?, ?, ?)`);
    const fts = db.prepare(`INSERT INTO chunks_fts (rowid, title, heading, text) VALUES (?, ?, ?, ?)`);
    rows.forEach((r, i) => {
      chunk.run(i + 1, r.article.path, r.heading, r.text, vectors ? toBlob(vectors[i]) : null);
      fts.run(i + 1, r.article.title, r.heading ?? "", r.text);
    });
    const meta = db.prepare(`INSERT INTO meta VALUES (?, ?)`);
    meta.run("built_at", new Date().toISOString());
    meta.run("embeddings", vectors ? "1" : "0");
    db.exec("COMMIT");

    // Validate before the swap: every article and chunk made it in, and FTS answers
    const count = (sql: string) => Number((db.prepare(sql).get() as { c: number }).c);
    if (count(`SELECT count(*) AS c FROM docs`) !== articles.length) throw new Error("Document count mismatch");
    if (count(`SELECT count(*) AS c FROM chunks`) !== rows.length) throw new Error("Chunk count mismatch");
    if (count(`SELECT count(*) AS c FROM chunks_fts`) !== rows.length) throw new Error("Keyword index count mismatch");
    if (vectors && count(`SELECT count(*) AS c FROM chunks WHERE length(embedding) = 4096`) !== rows.length) {
      throw new Error("Embedding size mismatch");
    }
    db.close();
    renameSync(building, kbDbPath());

    const status: IndexStatus = {
      state: "idle",
      startedAt,
      finishedAt: new Date().toISOString(),
      docs: articles.length,
      chunks: rows.length,
      embeddings: !!vectors,
      reason,
    };
    writeStatus(status);
    return status;
  } catch (err) {
    rmSync(building, { force: true });
    const status: IndexStatus = {
      state: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      reason,
    };
    writeStatus(status);
    return status;
  } finally {
    rmSync(lockPath(), { force: true });
  }
}
