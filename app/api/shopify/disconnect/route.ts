import { disconnect } from "@/lib/shopify-connect";
import { requireOwner } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Uninstall the app from the store and forget its keys
export async function POST(request: Request) {
  const user = requireOwner(request);
  if (user instanceof Response) return user;
  const result = await disconnect(user);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ shop: result.shop, uninstalled: result.uninstalled });
}
