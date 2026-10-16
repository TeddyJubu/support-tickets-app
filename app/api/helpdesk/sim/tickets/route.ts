import { createSimTicket, getSimTicketDetail, type SimTicketInput } from "@/lib/sim-db";
import { isSimulatorRequest, unauthorized } from "@/lib/sim-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simulator: open a new ticket as a (pseudonymous) customer
export async function POST(request: Request) {
  if (!isSimulatorRequest(request)) return unauthorized();
  const body = (await request.json().catch(() => null)) as SimTicketInput | null;
  if (!body?.customer?.sourceKey || !body.customer.email || !body.subject || !body.body) {
    return Response.json(
      { error: "customer.sourceKey, customer.email, subject and body are required" },
      { status: 400 },
    );
  }
  const id = createSimTicket(body);
  return Response.json(getSimTicketDetail(id), { status: 201 });
}
