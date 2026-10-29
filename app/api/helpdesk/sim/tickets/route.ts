import { createSimTicket, getDb, simulatorView, type SimTicketInput } from "@/lib/sim-db";
import { createSimReturn, type SimReturnInput } from "@/lib/returns";
import { transaction } from "@/lib/db";
import { isSimulatorRequest, unauthorized } from "@/lib/sim-auth";
import { isProductHandle } from "@/lib/helpdesk-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simulator: open a new ticket as a (pseudonymous) customer, optionally with a simulated
// return or exchange for its order (simReturn). Answers with the simulator's view of it.
export async function POST(request: Request) {
  if (!isSimulatorRequest(request)) return unauthorized();
  const body = (await request.json().catch(() => null)) as (SimTicketInput & { simReturn?: SimReturnInput }) | null;
  if (!body?.customer?.sourceKey || !body.customer.email || !body.subject || !body.body) {
    return Response.json(
      { error: "customer.sourceKey, customer.email, subject and body are required" },
      { status: 400 },
    );
  }
  // Email customer keys belong to real senders: a simulated ticket can't file under one
  if (String(body.customer.sourceKey).startsWith("email:")) {
    return Response.json({ error: "customer.sourceKey can't be an email key" }, { status: 400 });
  }
  if (body.productHandle != null && !isProductHandle(body.productHandle)) {
    return Response.json({ error: "productHandle must be a catalog product handle" }, { status: 400 });
  }
  if (body.simReturn && !/^#S\d+$/.test(body.orderName ?? "")) {
    return Response.json({ error: "simReturn needs a simulated orderName (#S…)" }, { status: 400 });
  }
  const { simReturn, ...input } = body;
  const id = transaction(getDb(), () => {
    const ticketId = createSimTicket({ ...input, channel: "simulator", senderVerified: null });
    if (simReturn) createSimReturn(ticketId, input.orderName!, simReturn);
    return ticketId;
  });
  return Response.json(simulatorView(id), { status: 201 });
}
