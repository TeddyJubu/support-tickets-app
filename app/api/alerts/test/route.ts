import { sendTestAlert } from "@/lib/alerts";
import { requireOwner } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Queue a test alert (the worker sends it within a minute)
export function POST(request: Request) {
  const user = requireOwner(request);
  if (user instanceof Response) return user;
  sendTestAlert(user.username);
  return Response.json({ ok: true }, { status: 202 });
}
