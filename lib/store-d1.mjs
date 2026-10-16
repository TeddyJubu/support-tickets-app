// Direct access to the private demo store's D1 database (the one behind the
// shop-sim Worker) through Cloudflare's D1 HTTP API. Nothing about the store is
// exposed publicly; this runs only on the server.
//
// Needs: SHOP_SIM_ACCOUNT_ID, SHOP_D1_DATABASE_ID, SHOP_D1_TOKEN (a token with D1: Edit)
// Shared by the simulator (scripts/simulate.mjs) and the helpdesk (lib/store.ts).

export function storeConfig(env) {
  const accountId = env.SHOP_SIM_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = env.SHOP_D1_DATABASE_ID;
  const token = env.SHOP_D1_TOKEN;
  return accountId && databaseId && token ? { accountId, databaseId, token } : null;
}

export async function d1(config, sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ sql, params }),
      cache: "no-store",
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const message = body?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new Error(`Store database: ${message}`);
  }
  return body.result?.[0]?.results ?? [];
}

// Simulated orders get their own name range (#S1001, #S1002, …) and a number far
// above the real ones, so they never collide with or look like real orders.
const SIM_NUMBER_BASE = 9_000_000_000_000; // real order numbers go up to ~7e11

let variantPool = null;
async function randomVariants(config) {
  if (!variantPool) {
    // A spread of real catalog items from active, published products
    variantPool = await d1(
      config,
      `SELECT v.id, v.sku, v.option1, v.price, p.title, p.handle
       FROM variants v JOIN products p ON p.id = v.product_id
       WHERE p.status = 'active' AND p.published = 1
       ORDER BY random() LIMIT 400`,
    );
    if (!variantPool.length) throw new Error("Store has no active products to order");
  }
  const count = 1 + Math.floor(Math.random() * 3);
  return Array.from({ length: count }, () => variantPool[Math.floor(Math.random() * variantPool.length)]);
}

// Create (or reuse) a pseudonymous customer and place an order for them.
// The store's variant prices are all 0.00, so `priceFor(handle)` can supply the
// real price (e.g. from the product export); otherwise the store price is used.
export async function placeSimOrder(config, persona, priceFor = () => null) {
  const now = new Date().toISOString();
  const email = persona.email.toLowerCase();

  let [customer] = await d1(config, "SELECT id FROM customers WHERE email = ? LIMIT 1", [email]);
  if (!customer) {
    const [{ next }] = await d1(config, "SELECT coalesce(max(id), 0) + 1 AS next FROM customers");
    await d1(
      config,
      `INSERT INTO customers (id, email, first_name, last_name, phone, province_code, country_code, tags, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'simulated', 'Simulated customer (pseudonym)', ?)`,
      [next, email, persona.firstName, persona.lastName, persona.phone ?? "", persona.province ?? "", persona.country ?? "", now],
    );
    customer = { id: next };
  }

  const items = await randomVariants(config);
  const lines = items.map((v) => ({
    variant_id: v.id,
    sku: v.sku ?? "",
    title: [v.title, v.option1].filter((x) => x && x !== "Default Title").join(" - "),
    quantity: 1,
    price: Number(priceFor(v.handle) ?? v.price ?? 0).toFixed(2),
  }));
  const total = lines.reduce((sum, l) => sum + Number(l.price) * l.quantity, 0).toFixed(2);

  const [{ seq }] = await d1(
    config,
    "SELECT coalesce(max(number) - ?, 1000) + 1 AS seq FROM orders WHERE number > ?",
    [SIM_NUMBER_BASE, SIM_NUMBER_BASE],
  );
  const [{ nextId }] = await d1(config, "SELECT coalesce(max(id), 0) + 1 AS nextId FROM orders");
  const name = `#S${seq}`;
  await d1(
    config,
    `INSERT INTO orders (id, name, number, customer_id, email, financial_status, total_price, currency, tags, note, created_at)
     VALUES (?, ?, ?, ?, ?, 'paid', ?, 'USD', 'simulated', 'Placed by the helpdesk customer simulator', ?)`,
    [nextId, name, SIM_NUMBER_BASE + seq, customer.id, email, total, now],
  );
  const [{ lineId }] = await d1(config, "SELECT coalesce(max(id), 0) + 1 AS lineId FROM order_lines");
  for (const [i, l] of lines.entries()) {
    await d1(
      config,
      "INSERT INTO order_lines (id, order_id, variant_id, sku, title, quantity, price) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [lineId + i, nextId, l.variant_id, l.sku, l.title, l.quantity, l.price],
    );
  }
  await d1(
    config,
    `UPDATE customers SET orders_count = orders_count + 1,
       total_spent = printf('%.2f', CAST(total_spent AS REAL) + ?) WHERE id = ?`,
    [Number(total), customer.id],
  );
  return { id: nextId, name, total_price: total, line_items: lines };
}

// Order in the Shopify Admin REST shape the helpdesk UI expects
export async function getOrderByName(config, name) {
  const [order] = await d1(config, "SELECT * FROM orders WHERE name = ? LIMIT 1", [name]);
  if (!order) return null;
  const [lines, fulfillments, refunds] = await Promise.all([
    d1(config, "SELECT title, quantity, price, sku FROM order_lines WHERE order_id = ? ORDER BY id", [order.id]),
    d1(config, "SELECT status, tracking_number, tracking_company FROM fulfillments WHERE order_id = ? ORDER BY id", [order.id]),
    d1(config, "SELECT amount FROM refunds WHERE order_id = ? ORDER BY id", [order.id]),
  ]);
  return {
    id: order.id,
    name: order.name,
    total_price: order.total_price,
    financial_status: order.financial_status,
    fulfillment_status: order.fulfillment_status,
    cancelled_at: order.cancelled_at,
    created_at: order.created_at,
    line_items: lines,
    fulfillments,
    refunds: refunds.map((r) => ({ transactions: [{ amount: r.amount }] })),
  };
}
