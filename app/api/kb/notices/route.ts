import { createNotice, listNotices, validateNotice } from "@/lib/kb/notices";
import { requireOwner } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ notices: listNotices() });
}

// Owner publishes a notice: { title, body, expiresAt? }
export async function POST(request: Request) {
  const user = requireOwner(request);
  if (user instanceof Response) return user;
  const checked = validateNotice((await request.json().catch(() => ({}))) as Record<string, unknown>);
  if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });
  return Response.json(createNotice(checked, user.username), { status: 201 });
}
