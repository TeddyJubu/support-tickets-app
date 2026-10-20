import { getSimTicketDetail } from "@/lib/sim-db";
import { applyChanges, parseChanges } from "@/lib/triage";
import { actorFromRequest, signInRequired } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Triage one ticket: status, priority, assignee, tags, snooze, read, trash, spam, subject
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = actorFromRequest(request);
  if (!actor) return signInRequired();
  const { id } = await params;
  const parsed = parseChanges(await request.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const userId = actor.kind === "staff" ? actor.user.id : null;
  const found = applyChanges([id], parsed.changes, actor.name, userId);
  if (!found.length) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json(getSimTicketDetail(id, userId ?? 0));
}
