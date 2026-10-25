import { getProduct, isProductHandle, searchProducts } from "@/lib/helpdesk-db";
import { isAgentRequest, signInRequired } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAgentRequest(request)) return signInRequired();
  const url = new URL(request.url);
  // Catalog facts only (title, price, sizes, stock): no customer or order data
  const handle = url.searchParams.get("handle");
  if (handle != null) {
    const product = isProductHandle(handle) ? getProduct(handle) : null;
    return product ? Response.json({ product }) : Response.json({ error: "Product not found" }, { status: 404 });
  }
  const limit = Math.min(Number(url.searchParams.get("limit")) || 8, 25);
  return Response.json({ products: searchProducts(url.searchParams.get("q") ?? "", limit) });
}
