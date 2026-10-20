// KB freshness for the KB page, /api/ready and the ops monitor

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { kbDir } from "./files";
import { indexStatus, kbDbPath } from "./index";

export const PRODUCTS_FRESH_HOURS = 96;

export function kbHealth() {
  const status = indexStatus();
  const indexBuiltAt = existsSync(kbDbPath()) ? statSync(kbDbPath()).mtime.toISOString() : null;
  const productsDir = join(kbDir(), "products");
  const productFiles = existsSync(productsDir) ? readdirSync(productsDir).filter((f) => f.endsWith(".md")) : [];
  const productsUpdatedAt = productFiles.length ? statSync(productsDir).mtime.toISOString() : null;
  const productsAgeHours = productsUpdatedAt ? (Date.now() - Date.parse(productsUpdatedAt)) / 3600e3 : null;
  return {
    index: status,
    indexBuiltAt,
    products: {
      files: productFiles.length,
      updatedAt: productsUpdatedAt,
      fresh: productsAgeHours !== null && productsAgeHours < PRODUCTS_FRESH_HOURS,
    },
  };
}
