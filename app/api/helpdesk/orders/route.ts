import { isSimOrder } from "@/lib/sim-db";
import { getOrderByName, storeConfig } from "@/lib/store-d1.mjs";
import { isAgentRequest, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Look up a simulated ticket's order in the private demo store's database.
// Only orders referenced by simulated tickets are returned, so the helpdesk
// can't be used to browse the store (which holds real customer data).
export async function GET(request: Request) {
  if (!isAgentRequest(request)) return unauthorized();
  const config = storeConfig(process.env);
  if (!config) return Response.json({ error: "Demo store is not configured" }, { status: 503 });
  const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
  if (!/^#S\d+$/.test(name) || !isSimOrder(name)) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }
  try {
    const order = await getOrderByName(config, name);
    if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
    return Response.json({ order });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Store lookup failed" }, { status: 502 });
  }
}
