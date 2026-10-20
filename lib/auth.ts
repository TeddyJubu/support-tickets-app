import { createHmac, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { isSimulatorRequest } from "./sim-auth";

export { unauthorized } from "./sim-auth";

// Agent sign-in: one shared password, stored as a scrypt hash in HELPDESK_PASSWORD_HASH
// (`npm run helpdesk -- set-password` writes it), and a stateless session cookie signed
// with SESSION_SECRET. The cookie names its user (`sub`) so per-user accounts can follow.
// Changing SESSION_SECRET signs everyone out.

export const SESSION_COOKIE = "hd_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

type Session = { sub: string; exp: number };

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET ?? "";
  return secret.length >= 32 ? secret : null;
}

const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const loginConfigured = () =>
  Boolean(sessionSecret()) && (process.env.HELPDESK_PASSWORD_HASH ?? "").startsWith("scrypt:");

export function createSessionToken(sub: string) {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const session: Session = { sub, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readSession(token: string | undefined): Session | null {
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

function sessionFrom(request: Request) {
  const prefix = `${SESSION_COOKIE}=`;
  const cookie = (request.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(prefix));
  return readSession(cookie?.slice(prefix.length));
}

// A signed-in agent, or the operator CLI / simulator with Bearer SIM_API_KEY.
// proxy.ts checks this for every request; route handlers check it again in case the proxy is bypassed.
export const isAgentRequest = (request: Request) => Boolean(sessionFrom(request)) || isSimulatorRequest(request);

// Where to go after signing in: only a path on this site, never another origin
export const safeNextPath = (value: unknown) =>
  typeof value === "string" && /^\/(?![/\\])[^\u0000-\u001f\u007f]*$/.test(value) ? value : "/";

// HELPDESK_PASSWORD_HASH is scrypt:<salt hex>:<key hex> (Node's scrypt defaults)
export async function passwordMatches(password: string) {
  const [scheme, salt, key] = (process.env.HELPDESK_PASSWORD_HASH ?? "").split(":");
  const expected = Buffer.from(key ?? "", "hex");
  if (scheme !== "scrypt" || !salt || expected.length < 32) return false;
  const actual = await scryptAsync(password, Buffer.from(salt, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
