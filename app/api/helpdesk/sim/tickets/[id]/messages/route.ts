import { addSimMessage, appendMessage, isSimulatedTicket, simulatorView } from "@/lib/sim-db";
import { isSimulatorRequest, unauthorized } from "@/lib/sim-auth";
import { audit } from "@/lib/auth";
import { signInRequired, staffFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Internal notes come from signed-in staff. The simulator/CLI key writes the simulated
// conversation (customer messages and simulated agent replies), on simulated tickets only.
// Staff replies use /api/helpdesk/tickets/[id]/send.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // A person or the simulator/CLI key, before anything else
  const user = staffFromRequest(request);
  if (!user && !isSimulatorRequest(request)) return signInRequired();
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    author?: string;
    body?: string;
    sender?: string;
  } | null;
  const author = body?.author ?? "agent";
  if (!body?.body?.trim()) return Response.json({ error: "body is required" }, { status: 400 });
  if (author !== "agent" && author !== "customer" && author !== "note") {
    return Response.json({ error: "author must be agent, note or customer" }, { status: 400 });
  }
  const text = body.body.slice(0, 10000);

  if (user) {
    if (author === "customer") return unauthorized();
    // Staff replies go through review-and-confirm (/api/helpdesk/tickets/[id]/send)
    if (author === "agent") return Response.json({ error: "Send replies through Review and Confirm & send" }, { status: 409 });
    // Notes are signed with the signed-in name, never a name the client sends
    const detail = addSimMessage(id, "note", text, user.displayName);
    if (!detail) return Response.json({ error: "Ticket not found" }, { status: 404 });
    audit(user.username, "note", id);
    return Response.json(detail, { status: 201 });
  }

  // Internal notes are signed by a person; the simulator/CLI key can't write them
  if (author === "note") return signInRequired();
  // The key never writes for, or to, a real customer: email and staff-opened tickets don't exist for it
  if (!isSimulatedTicket(id)) return Response.json({ error: `No simulated ticket ${id}` }, { status: 404 });
  if (author === "agent") audit("simulator", "reply", id, { channel: "simulated" });
  appendMessage(id, author, text, author === "agent" ? (body.sender ?? "Support (CLI)") : (body.sender ?? null));
  return Response.json(simulatorView(id), { status: 201 });
}
