import { beginConnect } from "@/lib/shopify-connect";
import { requireOwner } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Start connecting a store: { shop } → { url } for the browser to open (Shopify's approval page)
export async function POST(request: Request) {
  const user = requireOwner(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { shop?: unknown } | null;
  const result = beginConnect(request, user, body?.shop);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ url: result.url, shop: result.shop }, { headers: { "set-cookie": result.cookie } });
}
