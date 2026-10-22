import { handleWebhook, validWebhookHmac } from "@/lib/shopify-connect";
import { shopifyApp } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 1_000_000;

// Public: Shopify's webhooks (app uninstalled, privacy requests). Each is signed with the app
// secret, and the answer never holds data.
export async function POST(request: Request) {
  const app = shopifyApp();
  if (!app) return Response.json({ error: "Not set up" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "Too large" }, { status: 413 });
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_BYTES) return Response.json({ error: "Too large" }, { status: 413 });
  if (!validWebhookHmac(raw, request.headers.get("x-shopify-hmac-sha256"), app.clientSecret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  const id = request.headers.get("x-shopify-webhook-id") ?? request.headers.get("x-shopify-event-id");
  const topic = request.headers.get("x-shopify-topic");
  if (!id || !topic) return Response.json({ error: "Missing webhook headers" }, { status: 400 });
  let payload: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  handleWebhook({
    id,
    topic,
    shopDomain: request.headers.get("x-shopify-shop-domain") ?? String(payload?.shop_domain ?? ""),
    triggeredAt: request.headers.get("x-shopify-triggered-at"),
    payload,
  });
  return Response.json({ ok: true });
}
