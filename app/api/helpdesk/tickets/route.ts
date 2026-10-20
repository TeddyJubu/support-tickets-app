import { listTickets } from "@/lib/helpdesk-db";
import { listSimTickets } from "@/lib/sim-db";
import { isAgentRequest, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAgentRequest(request)) return unauthorized();
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const q = url.searchParams.get("q") ?? "";
  // source=sim lists simulator tickets; default is the historical export
  if (url.searchParams.get("source") === "sim") {
    return Response.json(
      listSimTickets({ q, limit, offset, status: url.searchParams.get("status") ?? "" }),
    );
  }
  return Response.json(
    listTickets({
      q,
      limit,
      offset,
      includeAutomated: url.searchParams.get("automated") === "1",
    }),
  );
}
