import { getTicketDetail } from "@/lib/helpdesk-db";
import { getSimTicketDetail, isSimTicketId } from "@/lib/sim-db";
import { staffFromRequest } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (isSimTicketId(id)) {
    const detail = getSimTicketDetail(id, staffFromRequest(request)?.id ?? 0);
    if (!detail) return Response.json({ error: "Ticket not found" }, { status: 404 });
    return Response.json(detail);
  }
  const detail = getTicketDetail(id);
  if (!detail) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json(detail);
}
