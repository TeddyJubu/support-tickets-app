// Staff accounts and sessions (data/sim.db).
// Passwords: PBKDF2-SHA256 with a per-user salt. Sessions: a random token in an HttpOnly
// cookie; only its SHA-256 is stored, so a copy of the database can't be used to log in.

import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { toSqlTime, transaction } from "./db";
import { getDb } from "./sim-db";

export type StaffRole = "owner" | "agent";

export interface StaffUser {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: StaffRole;
}

type Row = Record<string, unknown>;

const ITERATIONS = 310_000;
export const SESSION_COOKIE = "hd_session";
const IDLE_HOURS = 12;
const MAX_DAYS = 7;

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  return `pbkdf2$${ITERATIONS}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = pbkdf2Sync(password, Buffer.from(salt, "base64url"), Number(iterations), expected.length, "sha256");
  return timingSafeEqual(actual, expected);
}

// A hash to compare against when the username doesn't exist, so timing doesn't reveal it
const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

const toUser = (r: Row): StaffUser => ({
  id: Number(r.id),
  username: String(r.username),
  displayName: String(r.display_name),
  email: r.email == null ? null : String(r.email),
  role: r.role === "owner" ? "owner" : "agent",
});

export function validatePassword(password: string) {
  if (password.length < 12) return "Use at least 12 characters";
  if (password.length > 200) return "Use at most 200 characters";
  return null;
}

export function createUser(input: {
  username: string;
  displayName: string;
  password: string;
  email?: string | null;
  role?: StaffRole;
}) {
  if (!/^[a-z0-9._-]{2,40}$/i.test(input.username)) throw new Error("Username: 2–40 letters, digits, . _ -");
  const problem = validatePassword(input.password);
  if (problem) throw new Error(problem);
  const res = getDb()
    .prepare(
      `INSERT INTO staff_users (username, display_name, email, role, password_hash) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.username, input.displayName.trim() || input.username, input.email ?? null, input.role ?? "agent", hashPassword(input.password));
  return getUser(Number(res.lastInsertRowid))!;
}

export function setPassword(username: string, password: string) {
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const d = getDb();
  return transaction(d, () => {
    const user = d.prepare(`SELECT id FROM staff_users WHERE username = ?`).get(username) as Row | undefined;
    if (!user) return false;
    d.prepare(`UPDATE staff_users SET password_hash = ? WHERE id = ?`).run(hashPassword(password), Number(user.id));
    // A new password signs out every existing session
    d.prepare(`DELETE FROM staff_sessions WHERE user_id = ?`).run(Number(user.id));
    return true;
  });
}

export function setDisabled(username: string, disabled: boolean) {
  const d = getDb();
  return transaction(d, () => {
    const res = d
      .prepare(`UPDATE staff_users SET disabled_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE username = ?`)
      .run(disabled ? 1 : 0, username);
    if (disabled) {
      d.prepare(`DELETE FROM staff_sessions WHERE user_id IN (SELECT id FROM staff_users WHERE username = ?)`).run(username);
    }
    return res.changes > 0;
  });
}

export function getUser(id: number) {
  const r = getDb().prepare(`SELECT * FROM staff_users WHERE id = ? AND disabled_at IS NULL`).get(id) as Row | undefined;
  return r ? toUser(r) : null;
}

export function updateDisplayName(id: number, displayName: string) {
  const result = getDb()
    .prepare(`UPDATE staff_users SET display_name = ? WHERE id = ? AND disabled_at IS NULL`)
    .run(displayName, id);
  return result.changes > 0 ? getUser(id) : null;
}

export function listUsers() {
  return (getDb().prepare(`SELECT * FROM staff_users ORDER BY username`).all() as Row[]).map((r) => ({
    ...toUser(r),
    disabled: r.disabled_at != null,
    createdAt: String(r.created_at),
  }));
}

export const hasAnyUser = () => Boolean(getDb().prepare(`SELECT 1 FROM staff_users LIMIT 1`).get());

/** Staff who can be assigned tickets */
export function activeStaff() {
  return (getDb().prepare(`SELECT * FROM staff_users WHERE disabled_at IS NULL ORDER BY display_name`).all() as Row[]).map(toUser);
}

// ---------- login rate limiting ----------

const WINDOW = "-15 minutes";
const MAX_PER_IP = 20;
const MAX_FAILURES_PER_USER = 6;

export function loginBlocked(ip: string, username: string) {
  const d = getDb();
  const byIp = d.prepare(`SELECT count(*) AS c FROM login_attempts WHERE ip = ? AND at > datetime('now', ?)`).get(ip, WINDOW) as Row;
  const byUser = d
    .prepare(`SELECT count(*) AS c FROM login_attempts WHERE username = ? COLLATE NOCASE AND ok = 0 AND at > datetime('now', ?)`)
    .get(username, WINDOW) as Row;
  return Number(byIp.c) >= MAX_PER_IP || Number(byUser.c) >= MAX_FAILURES_PER_USER;
}

function recordAttempt(ip: string, username: string, ok: boolean) {
  const d = getDb();
  d.prepare(`INSERT INTO login_attempts (ip, username, ok) VALUES (?, ?, ?)`).run(ip, username.slice(0, 80), ok ? 1 : 0);
  d.prepare(`DELETE FROM login_attempts WHERE at < datetime('now', '-1 day')`).run();
}

export type LoginResult =
  | { ok: true; user: StaffUser; token: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "rate_limited" };

export function login(username: string, password: string, ip: string): LoginResult {
  if (loginBlocked(ip, username)) return { ok: false, reason: "rate_limited" };
  const r = getDb()
    .prepare(`SELECT * FROM staff_users WHERE username = ? AND disabled_at IS NULL`)
    .get(username) as Row | undefined;
  const valid = verifyPassword(password, r ? String(r.password_hash) : DUMMY_HASH) && !!r;
  recordAttempt(ip, username, valid);
  if (!valid || !r) return { ok: false, reason: "invalid" };
  const user = toUser(r);
  const session = createSession(user.id, String(r.password_hash));
  // The password changed (or the user was disabled) between the check and now
  if (!session) return { ok: false, reason: "invalid" };
  const { token, expiresAt } = session;
  return { ok: true, user, token, expiresAt };
}

// ---------- sessions ----------


/** Null when the user is disabled or, with expectedHash, the password changed (one atomic statement) */
export function createSession(userId: number, expectedHash?: string): { token: string; expiresAt: Date } | null {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + MAX_DAYS * 86400e3);
  const res = getDb()
    .prepare(
      `INSERT INTO staff_sessions (token_hash, user_id, expires_at)
       SELECT ?, id, ? FROM staff_users WHERE id = ? AND disabled_at IS NULL AND (? IS NULL OR password_hash = ?)`,
    )
    .run(sha256(token), toSqlTime(expiresAt), userId, expectedHash ?? null, expectedHash ?? null);
  return res.changes ? { token, expiresAt } : null;
}

/** The signed-in staff user for a session token, or null (expired, idle too long, disabled) */
export function sessionUser(token: string | null | undefined): StaffUser | null {
  if (!token || token.length > 100) return null;
  const d = getDb();
  const r = d
    .prepare(
      `SELECT u.*, s.token_hash, s.last_seen_at FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')
         AND s.last_seen_at > datetime('now', ?) AND u.disabled_at IS NULL`,
    )
    .get(sha256(token), `-${IDLE_HOURS} hours`) as Row | undefined;
  if (!r) return null;
  // Sliding idle timeout, written at most every five minutes
  d.prepare(
    `UPDATE staff_sessions SET last_seen_at = datetime('now')
     WHERE token_hash = ? AND last_seen_at < datetime('now', '-5 minutes')`,
  ).run(String(r.token_hash));
  return toUser(r);
}

export function endSession(token: string | null | undefined) {
  if (token) getDb().prepare(`DELETE FROM staff_sessions WHERE token_hash = ?`).run(sha256(token));
}

export function pruneSessions() {
  getDb()
    .prepare(`DELETE FROM staff_sessions WHERE expires_at < datetime('now') OR last_seen_at < datetime('now', ?)`)
    .run(`-${IDLE_HOURS} hours`);
}

// ---------- audit log ----------

export function audit(actor: string, action: string, ticketId?: string | null, detail?: unknown) {
  getDb()
    .prepare(`INSERT INTO audit_log (actor, action, ticket_id, detail) VALUES (?, ?, ?, ?)`)
    .run(actor, action, ticketId ?? null, detail === undefined ? null : JSON.stringify(detail));
}
