import { railForTicket } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customer rail: the ticket's simulated store customer, orders and returns (staff only, via proxy.ts)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rail = await railForTicket(id, { refresh: new URL(request.url).searchParams.get("refresh") === "1" });
  if (!rail) return Response.json({ error: "Ticket not found" }, { status: 404 });
  return Response.json(rail);
}
