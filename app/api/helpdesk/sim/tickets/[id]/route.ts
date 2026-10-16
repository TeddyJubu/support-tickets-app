import { setSimTicketStatus } from "@/lib/sim-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// UI: change a simulated ticket's status
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { status?: string };
  if (!body.status || !["open", "pending", "closed"].includes(body.status)) {
    return Response.json({ error: "status must be open, pending or closed" }, { status: 400 });
  }
  const detail = setSimTicketStatus(id, body.status as "open" | "pending" | "closed");
  if (!detail) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json(detail);
}
