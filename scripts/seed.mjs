#!/usr/bin/env node
// Seed data/helpdesk.db from the Shopify + Gorgias CSV exports.
//
// Usage: npm run seed [-- <exports-dir>]   (default: data/exports)
//
// Expects these files in the exports dir:
//   customers_export.csv            Shopify customers export
//   products_export_*.csv           Shopify products export (one row per variant/image)
//   tickets-part-*.csv              Gorgias tickets export

import { readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "csv-parse/sync";

const root = resolve(import.meta.dirname, "..");
const exportsDir = resolve(process.argv[2] ?? join(root, "data/exports"));
const dbPath = join(root, "data/helpdesk.db");

function readCsv(file) {
  return parse(readFileSync(file), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
}

function filesMatching(re) {
  return readdirSync(exportsDir)
    .filter((f) => re.test(f))
    .sort()
    .map((f) => join(exportsDir, f));
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const int = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const bool = (v) => (/^(true|yes|1)$/i.test(String(v ?? "").trim()) ? 1 : 0);
// Shopify prefixes some values with ' to keep spreadsheets from mangling them
const unquote = (v) => str(String(v ?? "").replace(/^'/, ""));

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

mkdirSync(join(root, "data"), { recursive: true });
rmSync(dbPath, { force: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    first_name TEXT, last_name TEXT, name TEXT,
    email TEXT, phone TEXT, company TEXT,
    address1 TEXT, address2 TEXT, city TEXT, province TEXT, country TEXT, zip TEXT,
    accepts_email INTEGER, accepts_sms INTEGER,
    total_spent REAL, total_orders INTEGER,
    note TEXT, tags TEXT, tax_exempt INTEGER
  );
  CREATE INDEX customers_email ON customers(email);

  CREATE TABLE products (
    handle TEXT PRIMARY KEY,
    title TEXT, vendor TEXT, category TEXT, type TEXT, tags TEXT,
    status TEXT, published INTEGER,
    description TEXT, image TEXT,
    price_min REAL, price_max REAL, compare_at_max REAL,
    variant_count INTEGER, inventory INTEGER,
    options TEXT, skus TEXT, final_sale INTEGER
  );

  CREATE TABLE tickets (
    id TEXT PRIMARY KEY,
    subject TEXT, tags TEXT, channel TEXT, priority TEXT, integration TEXT,
    created_by_agent INTEGER, created_at TEXT, closed_at TEXT,
    assignee_name TEXT, assignee_email TEXT,
    customer_email TEXT, customer_name TEXT,
    first_response_s INTEGER, resolution_s INTEGER,
    agent_messages INTEGER, customer_messages INTEGER,
    url TEXT, ai_intent TEXT, contact_reason TEXT, product TEXT,
    resolution TEXT, sentiment TEXT, customer_type TEXT,
    automated INTEGER
  );
  CREATE INDEX tickets_customer ON tickets(customer_email);
  CREATE INDEX tickets_created ON tickets(created_at);
  CREATE INDEX tickets_intent ON tickets(ai_intent);

  CREATE VIRTUAL TABLE customers_fts USING fts5(id UNINDEXED, name, email, phone, city, company, tags, tokenize='unicode61');
  CREATE VIRTUAL TABLE products_fts USING fts5(handle UNINDEXED, title, type, category, tags, options, skus, description, tokenize='porter unicode61');
  CREATE VIRTUAL TABLE tickets_fts USING fts5(id UNINDEXED, subject, customer_name, customer_email, tags, ai_intent, tokenize='porter unicode61');
`);

function inTransaction(fn) {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---------------------------------------------------------------- customers
{
  const files = filesMatching(/^customers.*\.csv$/i);
  const insert = db.prepare(`INSERT OR REPLACE INTO customers VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const fts = db.prepare(`INSERT INTO customers_fts VALUES (?,?,?,?,?,?,?)`);
  let n = 0;
  inTransaction(() => {
    for (const file of files) {
      for (const r of readCsv(file)) {
        const id = unquote(r["Customer ID"]);
        if (!id) continue;
        const first = str(r["First Name"]);
        const last = str(r["Last Name"]);
        const name = [first, last].filter(Boolean).join(" ") || null;
        const email = str(r["Email"])?.toLowerCase() ?? null;
        const phone = unquote(r["Phone"]) ?? unquote(r["Default Address Phone"]);
        const row = [
          id, first, last, name, email, phone,
          str(r["Default Address Company"]),
          str(r["Default Address Address1"]), str(r["Default Address Address2"]),
          str(r["Default Address City"]), str(r["Default Address Province Code"]),
          str(r["Default Address Country Code"]), unquote(r["Default Address Zip"]),
          bool(r["Accepts Email Marketing"]), bool(r["Accepts SMS Marketing"]),
          num(r["Total Spent"]) ?? 0, int(r["Total Orders"]) ?? 0,
          str(r["Note"]), str(r["Tags"]), bool(r["Tax Exempt"]),
        ];
        insert.run(...row);
        fts.run(id, name, email, phone, row[9], row[6], row[18]);
        n++;
      }
    }
  });
  console.log(`customers: ${n} rows from ${files.length} file(s)`);
}

// ----------------------------------------------------------------- products
{
  const files = filesMatching(/^products.*\.csv$/i);
  const byHandle = new Map();
  for (const file of files) {
    for (const r of readCsv(file)) {
      const handle = str(r["Handle"]);
      if (!handle) continue;
      let p = byHandle.get(handle);
      if (!p) {
        p = {
          handle, title: null, vendor: null, category: null, type: null,
          tags: null, status: null, published: 0, description: null,
          image: null, prices: [], compareAt: [], variants: 0, inventory: 0,
          options: new Map(), skus: new Set(), finalSale: 0,
        };
        byHandle.set(handle, p);
      }
      // Product-level fields are only filled on the first row of each handle
      p.title ??= str(r["Title"]);
      p.vendor ??= str(r["Vendor"]);
      p.category ??= str(r["Product Category"]);
      p.type ??= str(r["Type"]);
      p.tags ??= str(r["Tags"]);
      p.status ??= str(r["Status"]);
      if (bool(r["Published"])) p.published = 1;
      if (!p.description && str(r["Body (HTML)"]))
        p.description = stripHtml(r["Body (HTML)"]).slice(0, 1200);
      p.image ??= str(r["Image Src"]);
      if (/true|yes/i.test(r["Final Sale (product.metafields.custom.final_sale1)"] ?? ""))
        p.finalSale = 1;

      // Variant rows have a price; image-only rows don't
      const price = num(r["Variant Price"]);
      if (price !== null) {
        p.variants++;
        p.prices.push(price);
        const cmp = num(r["Variant Compare At Price"]);
        if (cmp !== null) p.compareAt.push(cmp);
        p.inventory += int(r["Variant Inventory Qty"]) ?? 0;
        const sku = str(r["Variant SKU"]);
        if (sku) p.skus.add(sku.replace(/^'/, ""));
        for (const i of [1, 2, 3]) {
          const name = str(r[`Option${i} Name`]);
          const value = str(r[`Option${i} Value`]);
          if (!value || value === "Default Title") continue;
          const key = name ?? `Option ${i}`;
          if (!p.options.has(key)) p.options.set(key, new Set());
          p.options.get(key).add(value);
        }
      }
    }
  }

  // Option names are only on the first variant row, so later rows land under "Option N"
  for (const p of byHandle.values()) {
    const named = [...p.options.keys()].filter((k) => !/^Option \d$/.test(k));
    for (const key of [...p.options.keys()]) {
      const m = /^Option (\d)$/.exec(key);
      const target = m && named[Number(m[1]) - 1];
      if (target) {
        for (const v of p.options.get(key)) p.options.get(target).add(v);
        p.options.delete(key);
      }
    }
  }

  const insert = db.prepare(`INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const fts = db.prepare(`INSERT INTO products_fts VALUES (?,?,?,?,?,?,?,?)`);
  inTransaction(() => {
    for (const p of byHandle.values()) {
      const options = [...p.options].map(([k, v]) => `${k}: ${[...v].join(", ")}`).join(" | ") || null;
      const skus = [...p.skus].slice(0, 200).join(" ") || null;
      insert.run(
        p.handle, p.title, p.vendor, p.category, p.type, p.tags, p.status, p.published,
        p.description, p.image,
        p.prices.length ? Math.min(...p.prices) : null,
        p.prices.length ? Math.max(...p.prices) : null,
        p.compareAt.length ? Math.max(...p.compareAt) : null,
        p.variants, p.inventory, options, skus, p.finalSale,
      );
      fts.run(p.handle, p.title, p.type, p.category, p.tags, options, skus, p.description);
    }
  });
  console.log(`products: ${byHandle.size} products from ${files.length} file(s)`);
}

// ------------------------------------------------------------------ tickets
{
  const files = filesMatching(/^tickets.*\.csv$/i);
  // Only the first part has a header row; reuse it for the rest
  let header = null;
  const AUTOMATED = /(no-?reply|mailer-daemon|postmaster|notifications?@|shipstation|@shopify\.com|@gorgias)/i;
  const insert = db.prepare(`INSERT OR REPLACE INTO tickets VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const fts = db.prepare(`INSERT INTO tickets_fts VALUES (?,?,?,?,?,?)`);
  let n = 0;
  inTransaction(() => {
    for (const file of files) {
      const rows = parse(readFileSync(file), { bom: true, skip_empty_lines: true, relax_column_count: true });
      if (rows[0]?.[0] === "Ticket id") header = rows.shift();
      if (!header) throw new Error(`No header row found before ${file}`);
      for (const values of rows) {
        const r = Object.fromEntries(header.map((h, i) => [h, values[i]]));
        const id = str(r["Ticket id"]);
        if (!id) continue;
        const email = str(r["Customer email"])?.toLowerCase() ?? null;
        const row = [
          id, str(r["Subject"]), str(r["Tags"]), str(r["Channel"]), str(r["Priority"]),
          str(r["Last used integration name"]), bool(r["Created by an agent"]),
          str(r["Creation date"]), str(r["Closed date"]),
          str(r["Assignee name"]), str(r["Assignee email"]),
          email, str(r["Customer name"]),
          int(r["First response time (s)"]), int(r["Resolution time (s)"]),
          int(r["Number of agent messages"]) ?? 0, int(r["Number of customer messages"]) ?? 0,
          str(r["Ticket URL"]), str(r["Ticket Field: AI Intent"]),
          str(r["Ticket Field: Contact reason"]), str(r["Ticket Field: Product"]),
          str(r["Ticket Field: Resolution"]), str(r["Ticket Field: Managed sentiment"]),
          str(r["Customer Field: Customer Type"]),
          email && AUTOMATED.test(email) ? 1 : 0,
        ];
        insert.run(...row);
        fts.run(id, row[1], row[12], email, row[2], row[18]);
        n++;
      }
    }
  });
  console.log(`tickets: ${n} rows from ${files.length} file(s)`);
}

db.exec("PRAGMA optimize; VACUUM;");
db.close();
console.log(`wrote ${dbPath}`);
