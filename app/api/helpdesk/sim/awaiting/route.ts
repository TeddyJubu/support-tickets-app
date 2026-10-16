import { ticketsAwaitingCustomer } from "@/lib/sim-db";
import { isSimulatorRequest, unauthorized } from "@/lib/sim-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simulator: tickets where an agent replied and the customer hasn't answered yet
export async function GET(request: Request) {
  if (!isSimulatorRequest(request)) return unauthorized();
  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit")) || 20, 100);
  return Response.json({ tickets: ticketsAwaitingCustomer(limit) });
}
