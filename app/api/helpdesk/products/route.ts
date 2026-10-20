import { searchProducts } from "@/lib/helpdesk-db";
import { isAgentRequest, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAgentRequest(request)) return unauthorized();
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 8, 25);
  return Response.json({ products: searchProducts(url.searchParams.get("q") ?? "", limit) });
}
