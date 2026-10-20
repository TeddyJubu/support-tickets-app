// Product sync: the catalog (active, published products from the store export) becomes
// KB articles in data/kb/products/, one file per brand with a "## " section per product.
// The new folder is built beside the old one and swapped in only if it looks right.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { catalogProducts } from "../helpdesk-db";
import { kbDir } from "./files";

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "other";
const money = (v: unknown) => (v == null ? null : `$${Number(v).toFixed(2)}`);
const clean = (v: unknown) =>
  String(v ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function section(p: Record<string, unknown>) {
  const min = money(p.price_min);
  const max = money(p.price_max);
  const price = min && max && min !== max ? `${min}–${max}` : (min ?? "unknown");
  const lines = [
    `## ${clean(p.title) || String(p.handle)}`,
    "",
    `- Price: ${price}`,
    p.type ? `- Type: ${clean(p.type)}` : null,
    p.options ? `- Options: ${clean(p.options).slice(0, 300)}` : null,
    `- In stock: ${Number(p.inventory) > 0 ? "yes" : "no (check before promising)"}`,
    Number(p.final_sale) === 1 ? "- Final sale: yes, not returnable" : null,
    p.tags ? `- Tags: ${clean(p.tags).slice(0, 200)}` : null,
    `- Handle: ${String(p.handle)}`,
  ].filter((l) => l !== null);
  const description = clean(p.description).slice(0, 600);
  if (description) lines.push("", description);
  return lines.join("\n");
}

export interface ProductSyncResult {
  ok: boolean;
  products: number;
  files: number;
  error?: string;
}

/** Writes the products folder. Refuses a catalog that shrank by more than half. */
export function syncProducts(): ProductSyncResult {
  const products = catalogProducts();
  if (!products.length) return { ok: false, products: 0, files: 0, error: "The catalog export has no active products" };
  const dir = join(kbDir(), "products");
  // Products currently published ("## " sections), to refuse an export that lost most of them
  const previous = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .reduce((n, f) => n + (readFileSync(join(dir, f), "utf8").match(/^## /gm)?.length ?? 0), 0)
    : 0;
  if (previous > 0 && products.length < previous / 2) {
    return { ok: false, products: products.length, files: 0, error: `Only ${products.length} products (was ${previous}): not replacing` };
  }

  const byVendor = new Map<string, Record<string, unknown>[]>();
  for (const p of products) {
    const vendor = clean(p.vendor) || "Other";
    byVendor.set(vendor, [...(byVendor.get(vendor) ?? []), p]);
  }

  const next = `${dir}.new-${process.pid}`;
  rmSync(next, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  const used = new Set<string>();
  for (const [vendor, items] of byVendor) {
    let name = slug(vendor);
    while (used.has(name)) name += "-x";
    used.add(name);
    const body = [
      "---",
      `title: ${vendor.replace(/[\r\n]/g, " ")} products`,
      "category: products",
      "status: generated",
      `tags: [products, ${slug(vendor)}]`,
      "---",
      "",
      `Catalog facts for ${vendor}, generated from the store export. Prices and stock can change: check the order or store before promising.`,
      "",
      ...items.map(section),
      "",
    ].join("\n");
    writeFileSync(join(next, `${name}.md`), body);
  }
  const old = `${dir}.old-${process.pid}`;
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(next, dir);
  rmSync(old, { recursive: true, force: true });
  return { ok: true, products: products.length, files: byVendor.size };
}
