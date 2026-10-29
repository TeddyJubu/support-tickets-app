import { findSimilarTickets } from "@/lib/helpdesk-db";
import { getSimTicketDetail, isSimTicketId } from "@/lib/sim-db";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit")) || 5, 20);
  // Simulated tickets are compared through the historical ticket they replay
  const baseId = isSimTicketId(id) ? getSimTicketDetail(id)?.ticket.sourceTicketId : id;
  return Response.json({ tickets: baseId ? findSimilarTickets(baseId, limit) : [] });
}
