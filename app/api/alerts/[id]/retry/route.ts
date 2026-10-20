import { retryAlert } from "@/lib/alerts";
import { requireOwner } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireOwner(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!/^\d+$/.test(id) || !retryAlert(Number(id), user.username)) return Response.json({ error: "Only failed or skipped alerts can be retried" }, { status: 409 });
  return Response.json({ ok: true });
}
