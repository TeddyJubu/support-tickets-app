import {
  createSessionToken,
  loginConfigured,
  passwordMatches,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Failed sign-ins per client IP (Caddy sets X-Forwarded-For); 10 per 15 minutes
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

const seeOther = (location: string, headers: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { location, ...headers } });

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
  if (typeof password !== "string" || !(await passwordMatches(password.slice(0, 1000)))) {
    failures.set(ip, { count: (active?.count ?? 0) + 1, until: active?.until ?? now + WINDOW_MS });
    if (failures.size > 10_000) for (const [key, f] of failures) if (f.until <= now) failures.delete(key);
    return back("invalid");
  }
  failures.delete(ip);

  const cookie = [
    `${SESSION_COOKIE}=${createSessionToken("agent")}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    // Plain http only in local development
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
  return seeOther(next, { "set-cookie": cookie });
}
