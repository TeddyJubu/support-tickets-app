import { audit, hasAnyUser, login } from "@/lib/auth";
import { clientIp, sessionCookie } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password) return Response.json({ error: "Enter your username and password" }, { status: 400 });
  if (!hasAnyUser()) {
    return Response.json(
      { error: "No staff accounts exist yet. Create one on the server: npm run helpdesk -- user add <username> --owner" },
      { status: 409 },
    );
  }
  const result = login(username, password.slice(0, 200), clientIp(request));
  if (!result.ok) {
    return result.reason === "rate_limited"
      ? Response.json({ error: "Too many attempts. Wait 15 minutes and try again." }, { status: 429 })
      : Response.json({ error: "Wrong username or password" }, { status: 401 });
  }
  audit(result.user.username, "login");
  return Response.json(
    { user: result.user },
    { headers: { "set-cookie": sessionCookie(request, result.token, result.expiresAt) } },
  );
}
