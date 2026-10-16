import { searchCustomers } from "@/lib/helpdesk-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 8, 25);
  return Response.json({ customers: searchCustomers(url.searchParams.get("q") ?? "", limit) });
}
