// Email attachments, stored content-addressed in data/attachments/<sha256> (so a retried
// email never stores a file twice). Served only to signed-in staff, see
// app/api/helpdesk/attachments/[id]. Only plain raster images are ever shown inline.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./db";
import { getDb } from "./sim-db";
import type { AttachmentInput } from "./sim-db";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;
// Executables and scripts are never stored
const BLOCKED = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jse|jar|sh|app|dmg|iso|html?|svg|xhtml)$/i;
export const INLINE_TYPES = /^image\/(png|jpe?g|gif|webp)$/i;

const dir = () => join(dataDir(), "attachments");

export function saveAttachment(content: Uint8Array, filename: string, contentType: string): AttachmentInput {
  const name = (filename || "attachment").replace(/[\r\n"\\/]/g, "_").slice(0, 200);
  const type = (contentType || "application/octet-stream").toLowerCase().slice(0, 100);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const meta = { filename: name, contentType: type, size: content.byteLength, sha256 };
  if (content.byteLength > MAX_ATTACHMENT_BYTES || BLOCKED.test(name) || /svg|html|javascript/.test(type)) {
    return { ...meta, stored: false };
  }
  mkdirSync(dir(), { recursive: true });
  const path = join(dir(), sha256);
  if (!existsSync(path)) {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, content, { mode: 0o600 });
    renameSync(tmp, path);
  }
  return { ...meta, stored: true };
}

export function readAttachment(id: number) {
  const row = getDb().prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row || Number(row.stored) !== 1) return null;
  const sha = String(row.sha256);
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  const path = join(dir(), sha);
  if (!existsSync(path)) return null;
  return {
    filename: String(row.filename),
    contentType: String(row.content_type),
    content: readFileSync(path),
  };
}
