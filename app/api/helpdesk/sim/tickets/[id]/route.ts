import { getSimTicketDetail } from "@/lib/sim-db";
import { applyChanges, parseChanges } from "@/lib/triage";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Triage one ticket: status, priority, assignee, tags, snooze, read, trash, spam, subject
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const parsed = parseChanges(await request.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const found = applyChanges([id], parsed.changes, user.username, user.id);
  if (!found.length) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json(getSimTicketDetail(id, user.id));
}
