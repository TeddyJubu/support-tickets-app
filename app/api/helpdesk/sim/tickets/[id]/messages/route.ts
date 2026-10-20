import { addSimMessage } from "@/lib/sim-db";
import { isAgentRequest } from "@/lib/auth";
import { isSimulatorRequest, unauthorized } from "@/lib/sim-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Agent replies come from the UI or CLI; customer messages only from the simulator
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
  if (!(author === "customer" ? isSimulatorRequest(request) : isAgentRequest(request))) return unauthorized();
  const detail = addSimMessage(id, author, body.body.slice(0, 10000), body.sender ?? null);
  if (!detail) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json(detail, { status: 201 });
}
