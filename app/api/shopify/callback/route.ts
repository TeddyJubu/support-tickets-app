import { clearStateCookie, finishConnect } from "@/lib/shopify-connect";
import { requireOwner } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shopify sends the owner's browser back here after they approve the app; back to Settings either way
export async function GET(request: Request) {
  const user = requireOwner(request);
  if (user instanceof Response) return user;
  const result = await finishConnect(request, user);
  const query = result.ok ? "shopify=connected" : `shopify=error&reason=${encodeURIComponent(result.error)}`;
  return new Response(null, { status: 303, headers: { location: `/settings?${query}`, "set-cookie": clearStateCookie(request) } });
}
