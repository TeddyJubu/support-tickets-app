import {
  agentsExist,
  createSessionToken,
  loginConfigured,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sharedPasswordMatches,
} from "@/lib/auth";
import { getDb } from "@/lib/sim-db";
import { agentLogin, decoyPasswordHash, verifyPassword } from "@/lib/agents.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Failed sign-ins per client IP (Caddy sets X-Forwarded-For); 10 per 15 minutes
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

const seeOther = (location: string, headers: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { location, ...headers } });

// Who the form's email + password sign in as, or null. Before any agent exists, only the
// shared password works (and the email is ignored).
async function signIn(email: unknown, password: string): Promise<{ sub: string; v?: number } | null> {
  if (!agentsExist()) return (await sharedPasswordMatches(password)) ? { sub: "shared" } : null;
  const found = typeof email === "string" ? agentLogin(getDb(), email.slice(0, 320)) : null;
  // Check a decoy hash for unknown emails, so they take as long as a wrong password
  const ok = await verifyPassword(found?.passwordHash ?? decoyPasswordHash(), password);
  if (!ok || !found || found.agent.disabled) return null;
  return { sub: `agent:${found.agent.id}`, v: found.agent.sessionVersion };
}

// The /login form posts here; success sets the session cookie and returns to `next`
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const next = safeNextPath(form?.get("next"));
  const back = (error: string) => seeOther(`/login?${new URLSearchParams({ error, next })}`);
  if (!loginConfigured()) return back("setup");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  const recent = failures.get(ip);
  const active = recent && recent.until > now ? recent : null;
  if (active && active.count >= MAX_FAILURES) return back("locked");

  const password = form?.get("password");
  const session = typeof password === "string" ? await signIn(form?.get("email"), password.slice(0, 1000)) : null;
  if (!session) {
    failures.set(ip, { count: (active?.count ?? 0) + 1, until: active?.until ?? now + WINDOW_MS });
    if (failures.size > 10_000) for (const [key, f] of failures) if (f.until <= now) failures.delete(key);
    return back("invalid");
  }
  failures.delete(ip);

  const cookie = [
    `${SESSION_COOKIE}=${createSessionToken(session.sub, session.v)}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    // Plain http only in local development
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
  return seeOther(next, { "set-cookie": cookie });
}
