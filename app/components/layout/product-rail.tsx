"use client";

// The catalog product a simulated ticket is about: title, price, sizes, stock and final sale,
// read from the store's product catalog. Catalog facts only, never customer or order data.

import { useEffect, useState } from "react";
import { ImageOff, Tag } from "lucide-react";
import type { Product } from "@/lib/helpdesk-types";
import { apiJson } from "../api";

const money = (v: number | null) => (v == null ? "unavailable" : v.toLocaleString(undefined, { style: "currency", currency: "USD" }));

function price(p: Product) {
  if (p.priceMin == null) return "Price unavailable";
  return p.priceMax != null && p.priceMax !== p.priceMin ? `${money(p.priceMin)}–${money(p.priceMax)}` : money(p.priceMin);
}

export function ProductRail({ handle }: { handle: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let live = true;
    apiJson<{ product: Product }>(`/api/helpdesk/products?handle=${encodeURIComponent(handle)}`)
      .then((r) => live && setProduct(r.product))
      .catch((err) => live && setError(err instanceof Error ? err.message : "Couldn't load the product"));
    return () => {
      live = false;
    };
  }, [handle]);

  return (
    <section className="border-b border-border px-5 py-4 last:border-b-0">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Product</h3>
      {error ? (
        <p className="text-xs text-muted-foreground">Product details unavailable: {error}</p>
      ) : !product ? (
        <p className="text-xs text-muted-foreground">Loading product…</p>
      ) : (
        <div className="flex gap-3 rounded-lg bg-muted/60 p-3 text-xs">
          {product.image && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- Shopify CDN image, shown as-is
            <img
              src={product.image}
              alt={product.title ?? "Product image"}
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
              className="size-16 shrink-0 rounded-md bg-background object-cover"
            />
          ) : (
            <span role="img" aria-label="Product image unavailable" className="flex size-16 shrink-0 items-center justify-center rounded-md bg-background">
              <ImageOff className="size-5 text-muted-foreground" />
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <p className="font-medium leading-snug text-foreground">{product.title ?? product.handle}</p>
            {product.vendor && <p className="text-muted-foreground">{product.vendor}</p>}
            <p className="font-medium tabular-nums">{price(product)}</p>
            {product.options && <p className="text-muted-foreground">{product.options}</p>}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <span className="rounded bg-background px-1.5 py-0.5">{product.inventory > 0 ? `${product.inventory} in stock across all sizes` : "Out of stock in all sizes"}</span>
              {product.finalSale && (
                <span className="inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5 text-warning">
                  <Tag className="size-3" /> Final sale
                </span>
              )}
              {!product.published && <span className="rounded bg-background px-1.5 py-0.5 text-muted-foreground">Not on the site</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
