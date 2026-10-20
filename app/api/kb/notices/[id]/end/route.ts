import { endNotice } from "@/lib/kb/notices";
import { requireOwner } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireOwner(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!/^\d+$/.test(id) || !endNotice(Number(id), user.username)) {
    return Response.json({ error: "Notice not found or already ended" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
