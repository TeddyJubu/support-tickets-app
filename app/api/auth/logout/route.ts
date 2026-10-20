import { endSession } from "@/lib/auth";
import { clearSessionCookie, sessionToken } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  endSession(sessionToken(request));
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie(request) } });
}
