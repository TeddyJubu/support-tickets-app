import { orderForTicket } from "@/lib/store";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One order of a ticket's own customer, from the Shopify store: by name, or with no name the
// order the ticket is about. Always scoped to a ticket, so the helpdesk can't be used to
// browse the store; simulated tickets and unverified senders get nothing.
export async function GET(request: Request) {
  // Staff only: store data never goes to the simulator/CLI key
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const params = new URL(request.url).searchParams;
  const ticket = params.get("ticket")?.trim();
  if (!ticket) return Response.json({ error: "Which ticket? Pass ?ticket=" }, { status: 400 });
  const out = await orderForTicket(ticket, params.get("name"));
  if ("order" in out) return Response.json({ order: out.order });
  return Response.json({ error: out.error, recent: out.recent }, { status: out.status });
}
