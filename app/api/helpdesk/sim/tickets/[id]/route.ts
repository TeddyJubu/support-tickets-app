import { setSimTicketStatus } from "@/lib/sim-db";
import { audit } from "@/lib/auth";
import { actorFromRequest, signInRequired } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Change a ticket's status (staff UI or the server CLI)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = actorFromRequest(request);
  if (!actor) return signInRequired();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { status?: string };
  if (!body.status || !["open", "pending", "closed"].includes(body.status)) {
    return Response.json({ error: "status must be open, pending or closed" }, { status: 400 });
  }
  const detail = setSimTicketStatus(id, body.status as "open" | "pending" | "closed");
  if (!detail) return Response.json({ error: "Ticket not found" }, { status: 404 });
  audit(actor.name, "status", id, { status: body.status });
  return Response.json(detail);
}
