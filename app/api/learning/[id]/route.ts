import { reviewLesson } from "@/lib/learning";
import { requireOwner } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner approves (it becomes a KB example tonight) or rejects a lesson
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireOwner(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { decision?: string } | null;
  if (!/^\d+$/.test(id) || (body?.decision !== "approved" && body?.decision !== "rejected")) {
    return Response.json({ error: "decision must be approved or rejected" }, { status: 400 });
  }
  if (!reviewLesson(Number(id), body.decision, user.username)) return Response.json({ error: "Lesson not found or already promoted" }, { status: 409 });
  return Response.json({ ok: true });
}
