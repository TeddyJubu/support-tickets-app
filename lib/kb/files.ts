// Knowledge-base articles: Markdown files with front matter in data/kb/<folder>/<name>.md
// (HELPDESK_KB_DIR overrides). The KB is data, not code: it's edited from the console and
// isn't committed to git. Each "## " section is one search chunk.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db";

export const kbDir = () => process.env.HELPDESK_KB_DIR || join(dataDir(), "kb");

/** Indexed folders and their ranking weight (store-authored content outranks generated) */
export const FOLDER_WEIGHT: Record<string, number> = {
  intents: 1,
  faq: 1,
  policies: 1,
  tickets: 1,
  learned: 0.9,
  products: 0.85,
};
export const FOLDERS = Object.keys(FOLDER_WEIGHT);
/** Folders staff may edit in the console (products are generated, learned is promoted nightly) */
export const EDITABLE_FOLDERS = ["intents", "faq", "policies", "tickets"];

// Tags that mark an article as sensitive: drafts on these topics always go to a person
export const SENSITIVE_TAGS = new Set([
  "sensitive", "escalation", "escalate", "immediate", "refund", "refund-window", "chargeback", "dispute",
  "damaged", "defect", "wrong-item", "missing-item", "missing-accessory", "angry-customer", "upset-customer",
  "manager-request", "privacy", "cancel", "cancellation", "cancellations", "address-change", "final-sale",
  "final-sale-exception", "lost-package", "stolen-package",
]);

export interface Article {
  path: string; // "<folder>/<name>.md"
  folder: string;
  title: string;
  status: string | null;
  tags: string[];
  sensitive: boolean;
  body: string; // without front matter
  raw: string;
  mtimeMs: number;
}

export interface Chunk {
  heading: string | null;
  text: string;
}

const normalizeTag = (t: string) => t.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "");

export function parseFrontMatter(raw: string) {
  const meta: Record<string, string> = {};
  let body = raw;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
    }
  }
  const tagValue = (meta.tags ?? "").replace(/^\[|\]$/g, "");
  const tags = [...new Set(tagValue.split(",").map((t) => normalizeTag(t.replace(/^["']|["']$/g, ""))).filter(Boolean))];
  return { meta, body, tags };
}

export function parseArticle(path: string, raw: string, mtimeMs = 0): Article {
  const { meta, body, tags } = parseFrontMatter(raw);
  const folder = path.split("/")[0];
  const sensitiveFlag = /^(true|yes)$/i.test(meta.sensitive ?? "");
  const title = (meta.title ?? "").replace(/^["']|["']$/g, "") || /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || path;
  return {
    path,
    folder,
    title,
    status: meta.status ?? null,
    tags,
    sensitive: sensitiveFlag || tags.some((t) => SENSITIVE_TAGS.has(t)),
    body,
    raw,
    mtimeMs,
  };
}

/** "## " sections; text before the first heading is dropped when there are headings */
export function chunkArticle(article: Article): Chunk[] {
  const parts = article.body.split(/^##\s+/m);
  if (parts.length === 1) {
    const text = article.body.trim();
    return text ? [{ heading: null, text }] : [];
  }
  return parts
    .slice(1)
    .map((p) => {
      const [first, ...rest] = p.split("\n");
      return { heading: first.trim() || null, text: rest.join("\n").trim() };
    })
    .filter((c) => c.text);
}

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]{0,100}\.md$/i;

/** Validates "<folder>/<name>.md"; returns null for anything outside the KB folders */
export function safePath(path: string, folders = FOLDERS) {
  const [folder, name, ...extra] = String(path).split("/");
  if (extra.length || !folders.includes(folder) || !SAFE_NAME.test(name ?? "")) return null;
  return `${folder}/${name}`;
}

export function listArticles(): Article[] {
  const out: Article[] = [];
  for (const folder of FOLDERS) {
    const dir = join(kbDir(), folder);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!SAFE_NAME.test(name) || name.startsWith("_") || name.toLowerCase() === "readme.md") continue;
      const full = join(dir, name);
      out.push(parseArticle(`${folder}/${name}`, readFileSync(full, "utf8"), statSync(full).mtimeMs));
    }
  }
  return out;
}

export function readArticle(path: string) {
  const safe = safePath(path);
  if (!safe) return null;
  const full = join(kbDir(), safe);
  if (!existsSync(full)) return null;
  return parseArticle(safe, readFileSync(full, "utf8"), statSync(full).mtimeMs);
}

const BACKUP_KEEP = 20;
let backupSeq = 0;

// Atomic write (temp file + rename) with the previous version kept in .backups/
export function writeArticle(path: string, raw: string, opts: { create?: boolean; expectedMtimeMs?: number } = {}) {
  const safe = safePath(path, EDITABLE_FOLDERS);
  if (!safe) throw new Error("Articles can only be saved in intents, faq, policies or tickets, as name.md");
  if (raw.length > 200_000) throw new Error("Article is too long (200 KB max)");
  const full = join(kbDir(), safe);
  const exists = existsSync(full);
  if (opts.create && exists) throw new Error("An article with that name already exists");
  if (!opts.create && !exists) throw new Error("Article not found");
  if (exists && opts.expectedMtimeMs !== undefined && Math.abs(statSync(full).mtimeMs - opts.expectedMtimeMs) > 1) {
    throw new Error("Someone else changed this article. Reload it before saving.");
  }
  mkdirSync(join(kbDir(), safe.split("/")[0]), { recursive: true });
  if (exists) backup(safe, readFileSync(full, "utf8"));
  const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, raw);
  renameSync(tmp, full);
  return readArticle(safe)!;
}

function backup(path: string, previous: string) {
  const dir = join(kbDir(), ".backups");
  mkdirSync(dir, { recursive: true });
  const prefix = path.replace("/", "__");
  // Sortable and unique even for saves within the same millisecond
  writeFileSync(join(dir, `${prefix}.${String(Date.now()).padStart(15, "0")}-${String(++backupSeq).padStart(6, "0")}`), previous);
  const versions = readdirSync(dir).filter((f) => f.startsWith(`${prefix}.`)).sort();
  for (const old of versions.slice(0, Math.max(0, versions.length - BACKUP_KEEP))) unlinkSync(join(dir, old));
}

export function backupCount(path: string) {
  const dir = join(kbDir(), ".backups");
  if (!existsSync(dir)) return 0;
  const prefix = `${path.replace("/", "__")}.`;
  return readdirSync(dir).filter((f) => f.startsWith(prefix)).length;
}
