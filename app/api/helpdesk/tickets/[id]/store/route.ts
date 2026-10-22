import { railForTicket } from "@/lib/store";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customer rail: the ticket's Shopify customer, orders and returns (staff only, via proxy.ts)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Staff only: the simulator/CLI key opens /api/helpdesk/* but must not read store data
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const rail = await railForTicket(id, { refresh: new URL(request.url).searchParams.get("refresh") === "1" });
  if (!rail) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json(rail);
}
