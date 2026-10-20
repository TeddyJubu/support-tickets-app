import { addSimMessage } from "@/lib/sim-db";
import { isSimulatorRequest, unauthorized } from "@/lib/sim-auth";
import { audit } from "@/lib/auth";
import { actorFromRequest, signInRequired } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Agent replies come from signed-in staff (or the server CLI); customer messages only from the simulator
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    author?: string;
    body?: string;
    sender?: string;
  } | null;
  const author = body?.author ?? "agent";
  if (!body?.body?.trim()) return Response.json({ error: "body is required" }, { status: 400 });
  if (author !== "agent" && author !== "customer") {
    return Response.json({ error: "author must be agent or customer" }, { status: 400 });
  }
  if (author === "customer" && !isSimulatorRequest(request)) return unauthorized();
  let sender = body.sender ?? null;
  if (author === "agent") {
    const actor = actorFromRequest(request);
    if (!actor) return signInRequired();
    // Staff replies are signed with the signed-in name, never a name the client sends
    sender = actor.kind === "staff" ? actor.user.displayName : (body.sender ?? "Support (CLI)");
    audit(actor.name, "reply", id, { channel: "simulated" });
  }
  const detail = addSimMessage(id, author, body.body.slice(0, 10000), sender);
  if (!detail) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json(detail, { status: 201 });
}
