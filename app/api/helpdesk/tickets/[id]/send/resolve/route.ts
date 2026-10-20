import { resolvePendingSend } from "@/lib/sending";
import { getSimTicketDetail } from "@/lib/sim-db";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A person settles an unconfirmed send: { key, outcome: "sent" | "not_sent" }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { key?: unknown; outcome?: unknown } | null;
  if (typeof body?.key !== "string" || (body.outcome !== "sent" && body.outcome !== "not_sent")) {
    return Response.json({ error: "key and outcome (sent | not_sent) are required" }, { status: 400 });
  }
  const result = resolvePendingSend(id, body.key, body.outcome, user);
  if ("error" in result) return Response.json({ error: result.error }, { status: 409 });
  return Response.json(getSimTicketDetail(id, user.id));
}
