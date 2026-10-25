import { retryAlert } from "@/lib/alerts";
import { requireOwner } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireOwner(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "Only failed or skipped alerts can be retried" }, { status: 409 });
  const result = retryAlert(Number(id), user.username);
  if (!result.ok) return Response.json({ error: "Only failed or skipped alerts can be retried" }, { status: 409 });
  return Response.json(result);
}
