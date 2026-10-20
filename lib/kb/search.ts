// Hybrid KB search: FTS5 keyword ranking and embedding similarity, fused with reciprocal
// rank fusion and weighted by folder. Active Notice Board notices come back alongside the
// results: they override the KB.

import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import { embed } from "../workers-ai";
import { FOLDER_WEIGHT } from "./files";
import { kbDbPath } from "./index";
import { activeNotices, type Notice } from "./notices";

const RRF_K = 60;
const POOL = 40;

export interface KbResult {
  path: string;
  folder: string;
  title: string;
  heading: string | null;
  text: string;
  score: number;
  /** Escalation topic: drafts must go to a person */
  sensitive: boolean;
}

export interface KbSearchOutcome {
  results: KbResult[];
  notices: Notice[];
  mode: "hybrid" | "keyword" | "unavailable";
}

let cached: { db: DatabaseSync; ino: number; mtimeMs: number; vectors: Array<{ id: number; v: Float32Array }> | null } | null = null;

// Re-opens after a rebuild swapped the file
function openIndex() {
  const path = kbDbPath();
  if (!existsSync(path)) return null;
  const st = statSync(path);
  if (cached && cached.ino === st.ino && cached.mtimeMs === st.mtimeMs) return cached.db;
  cached?.db.close();
  cached = { db: new DatabaseSync(path, { readOnly: true }), ino: st.ino, mtimeMs: st.mtimeMs, vectors: null };
  return cached.db;
}

// Plain words only, OR-ed: user text can't inject FTS5 syntax
function ftsQuery(query: string) {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return [...new Set(words)].slice(0, 24).map((w) => `"${w}"`).join(" OR ");
}

function cosine(a: Float32Array, b: Float32Array) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

export async function searchKb(query: string, k = 5): Promise<KbSearchOutcome> {
  const notices = activeNotices();
  const db = openIndex();
  const q = query.trim().slice(0, 1000);
  if (!db || !q) return { results: [], notices, mode: db ? "keyword" : "unavailable" };

  const scores = new Map<number, number>();
  const fuse = (ids: number[]) => ids.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1)));

  const match = ftsQuery(q);
  if (match) {
    const hits = db.prepare(`SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts, 4.0, 2.0, 1.0) LIMIT ?`).all(match, POOL) as Array<{ id: number }>;
    fuse(hits.map((h) => Number(h.id)));
  }

  let mode: KbSearchOutcome["mode"] = "keyword";
  const hasVectors = (db.prepare(`SELECT value FROM meta WHERE key = 'embeddings'`).get() as { value?: string } | undefined)?.value === "1";
  if (hasVectors) {
    try {
      const qv = (await embed([q]))?.[0];
      if (qv) {
        const query32 = new Float32Array(qv);
        // Loaded once per index file (a rebuild swaps the file and reopens the cache)
        cached!.vectors ??= (db.prepare(`SELECT id, embedding FROM chunks`).all() as Array<{ id: number; embedding: Uint8Array }>).map((r) => ({
          id: Number(r.id),
          v: new Float32Array(fromBlob(r.embedding)),
        }));
        const ranked = cached!.vectors
          .map((r) => ({ id: r.id, s: cosine(query32, r.v) }))
          .sort((a, b) => b.s - a.s)
          .slice(0, POOL);
        fuse(ranked.map((r) => r.id));
        mode = "hybrid";
      }
    } catch {
      // Workers AI down: keyword results still answer
    }
  }

  if (!scores.size) return { results: [], notices, mode };
  const ids = [...scores.keys()];
  const rows = db
    .prepare(
      `SELECT c.id, c.heading, c.text, d.path, d.folder, d.title, d.sensitive FROM chunks c JOIN docs d ON d.path = c.path
       WHERE c.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as Array<Record<string, unknown>>;
  const results = rows
    .map((r) => ({
      path: String(r.path),
      folder: String(r.folder),
      title: String(r.title),
      heading: r.heading == null ? null : String(r.heading),
      text: String(r.text).slice(0, 1500),
      score: (scores.get(Number(r.id)) ?? 0) * (FOLDER_WEIGHT[String(r.folder)] ?? 1),
      sensitive: Number(r.sensitive) === 1,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(k, 1), 10));
  return { results, notices, mode };
}
