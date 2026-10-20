// Agent accounts: one sign-in per person, stored in data/sim.db next to the tickets.
// Plain JS so the app (lib/auth.ts) and the control CLI (scripts/helpdesk.mjs) share it,
// like lib/store-d1.mjs. Every function takes the open node:sqlite database.

import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 12;

/** @typedef {{ id: string, email: string, name: string, role: "admin" | "agent", disabled: boolean, sessionVersion: number, createdAt: string }} Agent */

export function ensureAgentsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'agent',          -- admin | agent
      password_hash TEXT NOT NULL,                 -- scrypt:<salt hex>:<key hex>
      session_version INTEGER NOT NULL DEFAULT 1,  -- bumped on password change or disable: signs them out
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// Same format as HELPDESK_PASSWORD_HASH (Node's scrypt defaults, 64-byte key)
export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

/** @returns {Promise<boolean>} */
export function verifyPassword(stored, password) {
  const [scheme, salt, key] = String(stored ?? "").split(":");
  const expected = Buffer.from(key ?? "", "hex");
  if (scheme !== "scrypt" || !salt || expected.length < 32) return Promise.resolve(false);
  return new Promise((done) =>
    scrypt(password, Buffer.from(salt, "hex"), expected.length, (err, actual) =>
      done(!err && timingSafeEqual(actual, expected)),
    ),
  );
}

// Checked against when the email is unknown, so a wrong email takes as long as a wrong password
let decoyHash = null;
export const decoyPasswordHash = () => (decoyHash ??= hashPassword(randomBytes(16).toString("hex")));

/** @returns {Agent} */
const toAgent = (r) =>
  r && {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name),
    role: r.role === "admin" ? "admin" : "agent",
    disabled: Boolean(r.disabled),
    sessionVersion: Number(r.session_version),
    createdAt: String(r.created_at),
  };

// All agents, disabled ones included: the shared password only works while this is 0
/** @returns {number} */
export const agentCount = (db) => Number(db.prepare(`SELECT count(*) AS c FROM agents`).get().c);

/** @returns {Agent[]} */
export const listAgents = (db) => db.prepare(`SELECT * FROM agents ORDER BY created_at, email`).all().map(toAgent);

/** @returns {Agent | null} */
export const getAgent = (db, id) => toAgent(db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id)) ?? null;

// For sign-in: the agent plus their password hash, which never leaves the server
/** @returns {{ agent: Agent, passwordHash: string } | null} */
export function agentLogin(db, email) {
  const r = db.prepare(`SELECT * FROM agents WHERE email = ?`).get(String(email ?? "").trim());
  return r ? { agent: toAgent(r), passwordHash: String(r.password_hash) } : null;
}

function checkPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

export function addAgent(db, { email, name, role = "agent", password }) {
  const address = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) throw new Error(`Not an email address: ${email}`);
  const displayName = String(name ?? "").trim();
  if (!displayName) throw new Error("A name is required.");
  if (role !== "admin" && role !== "agent") throw new Error("role must be admin or agent");
  checkPassword(password);
  if (agentLogin(db, address)) throw new Error(`${address} already has an account.`);
  const id = `agent-${randomBytes(6).toString("hex")}`;
  db.prepare(`INSERT INTO agents (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)`).run(
    id, address, displayName.slice(0, 100), role, hashPassword(password),
  );
  return getAgent(db, id);
}

function updateByEmail(db, email, sql, ...params) {
  const res = db.prepare(`UPDATE agents SET ${sql} WHERE email = ?`).run(...params, String(email ?? "").trim());
  if (res.changes === 0) throw new Error(`No agent with email ${email}`);
  return agentLogin(db, email).agent;
}

export function setAgentPassword(db, email, password) {
  checkPassword(password);
  return updateByEmail(db, email, `password_hash = ?, session_version = session_version + 1`, hashPassword(password));
}

export function setAgentDisabled(db, email, disabled) {
  return updateByEmail(db, email, `disabled = ?, session_version = session_version + 1`, disabled ? 1 : 0);
}
