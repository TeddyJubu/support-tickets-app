import { shopifyStatus } from "@/lib/shopify-connect";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Which store is connected (never its keys) and what the Shopify app needs
export function GET(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  return Response.json(shopifyStatus(user));
}
