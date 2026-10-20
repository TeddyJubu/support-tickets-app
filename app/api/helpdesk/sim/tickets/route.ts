import { createSimTicket, getDb, getSimTicketDetail, type SimTicketInput } from "@/lib/sim-db";
import { createSimReturn, type SimReturnInput } from "@/lib/returns";
import { transaction } from "@/lib/db";
import { isSimulatorRequest, unauthorized } from "@/lib/sim-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simulator: open a new ticket as a (pseudonymous) customer, optionally with a simulated
// return or exchange for its order (simReturn)
export async function POST(request: Request) {
  if (!isSimulatorRequest(request)) return unauthorized();
  const body = (await request.json().catch(() => null)) as (SimTicketInput & { simReturn?: SimReturnInput }) | null;
  if (!body?.customer?.sourceKey || !body.customer.email || !body.subject || !body.body) {
    return Response.json(
      { error: "customer.sourceKey, customer.email, subject and body are required" },
      { status: 400 },
    );
  }
  if (body.simReturn && !/^#S\d+$/.test(body.orderName ?? "")) {
    return Response.json({ error: "simReturn needs a simulated orderName (#S…)" }, { status: 400 });
  }
  const { simReturn, ...input } = body;
  const id = transaction(getDb(), () => {
    const ticketId = createSimTicket({ ...input, channel: "simulator" });
    if (simReturn) createSimReturn(ticketId, input.orderName!, simReturn);
    return ticketId;
  });
  return Response.json(getSimTicketDetail(id), { status: 201 });
}
