import { getTicketDetail } from "@/lib/helpdesk-db";
import { getSimTicketDetail, isSimTicketId } from "@/lib/sim-db";
import { isAgentRequest, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAgentRequest(request)) return unauthorized();
  const { id } = await params;
  const detail = isSimTicketId(id) ? getSimTicketDetail(id) : getTicketDetail(id);
  if (!detail) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json(detail);
}
