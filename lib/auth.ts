import { createHmac, timingSafeEqual } from "node:crypto";
import { isSimulatorRequest } from "./sim-auth";
import { getDb } from "./sim-db";
import { storeSettings } from "./settings";
import { agentCount, getAgent, verifyPassword } from "./agents.mjs";

export { unauthorized } from "./sim-auth";

// Agent sign-in. Each agent has their own account (lib/agents.mjs, managed with
// `npm run helpdesk -- agent …`). Until the first agent exists, one shared password
// (HELPDESK_PASSWORD_HASH, set with `npm run helpdesk -- set-password`) signs in instead.
// The session cookie is stateless, signed with SESSION_SECRET, and names the agent; every
// request re-checks the agent, so disabling one or changing their password signs them out.
// Changing SESSION_SECRET signs everyone out.

export const SESSION_COOKIE = "hd_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

// sub is "agent:<id>" (v = the agent's session_version), or "shared" for the shared password
type Session = { sub: string; exp: number; v?: number };

export interface SignedInAgent {
  /** null when signed in with the shared password */
  id: string | null;
  name: string;
  email: string | null;
  role: "admin" | "agent";
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET ?? "";
  return secret.length >= 32 ? secret : null;
}

const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const sharedPasswordSet = () => (process.env.HELPDESK_PASSWORD_HASH ?? "").startsWith("scrypt:");

// Agents exist: sign in with email + password. None yet: the shared password, if set.
export const agentsExist = () => agentCount(getDb()) > 0;

export const loginConfigured = () => Boolean(sessionSecret()) && (agentsExist() || sharedPasswordSet());

export function createSessionToken(sub: string, v?: number) {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const session: Session = { sub, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, ...(v ? { v } : {}) };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function readSession(token: string | undefined): Session | null {
  const secret = sessionSecret();
  if (!secret || !token) return null;
  const [payload, mac, ...extra] = token.split(".");
  if (!payload || !mac || extra.length || !safeEqual(mac, sign(payload, secret))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    return typeof session.sub === "string" && session.exp > Date.now() / 1000 ? session : null;
  } catch {
    return null;
  }
}

// The agent a session cookie belongs to, if it is still valid
export function agentFromSessionToken(token: string | undefined): SignedInAgent | null {
  const session = readSession(token);
  if (!session) return null;
  if (session.sub.startsWith("agent:")) {
    const agent = getAgent(getDb(), session.sub.slice("agent:".length));
    if (!agent || agent.disabled || agent.sessionVersion !== session.v) return null;
    return { id: agent.id, name: agent.name, email: agent.email, role: agent.role };
  }
  // "agent" is the shared-password cookie from before agent accounts existed
  if ((session.sub === "shared" || session.sub === "agent") && sharedPasswordSet() && !agentsExist()) {
    return { id: null, name: storeSettings().senderName, email: null, role: "admin" };
  }
  return null;
}

export function currentAgent(request: Request) {
  const prefix = `${SESSION_COOKIE}=`;
  const cookie = (request.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(prefix));
  return agentFromSessionToken(cookie?.slice(prefix.length));
}

// A signed-in agent, or the operator CLI / simulator with Bearer SIM_API_KEY.
// proxy.ts checks this for every request; route handlers check it again in case the proxy is bypassed.
export const isAgentRequest = (request: Request) => Boolean(currentAgent(request)) || isSimulatorRequest(request);

// Where to go after signing in: only a path on this site, never another origin
export const safeNextPath = (value: unknown) =>
  typeof value === "string" && /^\/(?![/\\])[^\u0000-\u001f\u007f]*$/.test(value) ? value : "/";

// The shared password (HELPDESK_PASSWORD_HASH), used only until the first agent exists
export const sharedPasswordMatches = (password: string) =>
  verifyPassword(process.env.HELPDESK_PASSWORD_HASH, password);
