import { markNotificationsRead, myNotifications } from "@/lib/notifications";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  return Response.json(myNotifications(user.id));
}

// { ids: [..] } or { all: true }
export async function POST(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null;
  const ids = body?.all === true ? "all" : Array.isArray(body?.ids) ? body.ids.filter((x): x is number => Number.isInteger(x)) : null;
  if (!ids) return Response.json({ error: "ids or all is required" }, { status: 400 });
  markNotificationsRead(user.id, ids);
  return Response.json(myNotifications(user.id));
}
