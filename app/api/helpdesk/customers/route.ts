import { searchCustomers } from "@/lib/helpdesk-db";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Store-export customer records (name, email, phone, address, spend): staff only
export async function GET(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 8, 25);
  return Response.json({ customers: searchCustomers(url.searchParams.get("q") ?? "", limit) });
}
