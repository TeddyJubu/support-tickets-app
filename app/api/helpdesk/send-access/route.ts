import { audit } from "@/lib/auth";
import { grantSendAccess, revokeSendAccess, sendAccess } from "@/lib/sending";
import { requireStaff, sessionToken } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Read & write": GET the state, POST { enable } to turn sending on (30 minutes) or off
export function GET(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  return Response.json({ expiresAt: sendAccess(sessionToken(request), user.id) });
}

export async function POST(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const token = sessionToken(request)!;
  const body = (await request.json().catch(() => null)) as { enable?: unknown } | null;
  if (typeof body?.enable !== "boolean") return Response.json({ error: "enable must be true or false" }, { status: 400 });
  if (!body.enable) {
    revokeSendAccess(token);
    return Response.json({ expiresAt: null });
  }
  const expiresAt = grantSendAccess(token, user.id);
  audit(user.username, "send_access_on");
  return Response.json({ expiresAt });
}
