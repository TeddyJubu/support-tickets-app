import { checkShopifyConnection, shopifyStatus } from "@/lib/shopify-connect";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Which store is connected (never its keys) and what the Shopify app needs
export function GET(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  return Response.json(shopifyStatus(user));
}

/** Test the active connection with shop metadata only (no customer or order reads). */
export async function POST(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  try {
    return Response.json({ ok: true, ...(await checkShopifyConnection()) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Shopify connection check failed" }, { status: 502 });
  }
}
