// Customer rail data from the demo store (Cloudflare D1), cached per ticket. If the store is
// slow or down, the last successful read is shown with its age. Only simulated customers
// and their simulated orders are ever read; amounts the store doesn't have are null
// ("unavailable"), never 0.

import { getDb } from "./sim-db";
import { getSimCustomerWithOrders, getSimOrderCustomerId, storeConfig } from "./store-d1.mjs";
import { returnsForTicket, type SimReturn } from "./returns";

const FRESH_SECONDS = 300;

export interface RailOrder {
  name: string;
  placedAt: string | null;
  total: number | null;
  currency: string | null;
  payment: string | null;
  fulfillment: string | null;
  cancelledAt: string | null;
  items: Array<{ title: string; quantity: number; price: number | null; sku: string | null }>;
  shipments: Array<{ status: string | null; carrier: string | null; tracking: string | null; shipmentStatus: string | null }>;
  refunds: Array<{ amount: number | null; note: string | null; at: string | null }>;
  refunded: number | null;
}

export interface StoreSnapshot {
  customer: {
    name: string;
    email: string | null;
    location: string | null;
    ordersCount: number | null;
    totalSpent: number | null;
    since: string | null;
  } | null;
  matchedOrder: RailOrder | null;
  orders: RailOrder[];
  /** The store doesn't track these: shown as "unavailable" */
  storeCredit: null;
  giftCards: null;
}

export interface RailResponse {
  available: boolean;
  /** Why there's no store data (not configured, not a simulated customer…) */
  reason: string | null;
  snapshot: StoreSnapshot | null;
  fetchedAt: string | null;
  /** The last refresh failed: showing an older read */
  stale: boolean;
  error: string | null;
  returns: SimReturn[];
}

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const s = (v: unknown) => (v == null || v === "" ? null : String(v));
const iso = (v: unknown) => (v == null ? null : `${String(v).replace(" ", "T")}Z`);

function toOrder(o: Row & { line_items: Row[]; fulfillments: Row[]; refunds: Row[] }): RailOrder {
  const refunds = o.refunds.map((r) => ({ amount: n(r.amount), note: s(r.note), at: s(r.created_at) }));
  return {
    name: String(o.name),
    placedAt: s(o.created_at),
    total: n(o.total_price),
    currency: s(o.currency),
    payment: s(o.financial_status),
    fulfillment: s(o.fulfillment_status),
    cancelledAt: s(o.cancelled_at),
    items: o.line_items.map((l) => ({ title: String(l.title ?? ""), quantity: Number(l.quantity ?? 1), price: n(l.price), sku: s(l.sku) })),
    shipments: o.fulfillments.map((f) => ({
      status: s(f.status),
      carrier: s(f.tracking_company),
      tracking: s(f.tracking_number),
      shipmentStatus: s(f.shipment_status),
    })),
    refunds,
    refunded: refunds.length ? refunds.reduce((sum, r) => sum + (r.amount ?? 0), 0) : 0,
  };
}

async function fetchSnapshot(storeCustomerId: string, orderName: string | null): Promise<StoreSnapshot | null> {
  const config = storeConfig(process.env);
  if (!config) throw new Error("not configured");
  const data = await getSimCustomerWithOrders(config, storeCustomerId);
  if (!data) return null;
  const c = data.customer as Row;
  const orders = (data.orders as Array<Row & { line_items: Row[]; fulfillments: Row[]; refunds: Row[] }>).map(toOrder);
  return {
    customer: {
      name: [c.first_name, c.last_name].filter(Boolean).join(" ") || String(c.email ?? ""),
      email: s(c.email),
      location: [c.city, c.province_code, c.country_code].filter(Boolean).join(", ") || null,
      ordersCount: n(c.orders_count),
      totalSpent: n(c.total_spent),
      since: s(c.created_at),
    },
    matchedOrder: orderName ? (orders.find((o) => o.name === orderName) ?? null) : null,
    orders,
    storeCredit: null,
    giftCards: null,
  };
}

export async function railForTicket(ticketId: string, opts: { refresh?: boolean } = {}): Promise<RailResponse | null> {
  const d = getDb();
  const t = d
    .prepare(
      `SELECT t.order_name, c.store_customer_id, c.source_key FROM sim_tickets t
       LEFT JOIN sim_customers c ON c.id = t.customer_id WHERE t.id = ?`,
    )
    .get(ticketId) as Row | undefined;
  if (!t) return null;
  const returns = returnsForTicket(ticketId);
  const empty = (reason: string): RailResponse => ({ available: false, reason, snapshot: null, fetchedAt: null, stale: false, error: null, returns });
  if (!storeConfig(process.env)) return empty("The demo store isn't connected.");
  if (String(t.source_key ?? "").startsWith("email:")) {
    return empty("Store lookups are limited to simulated customers in this test system.");
  }
  let storeCustomerId = s(t.store_customer_id);
  if (!storeCustomerId && t.order_name) {
    // Tickets from before the simulator recorded the store customer: find it from the order
    try {
      storeCustomerId = await getSimOrderCustomerId(storeConfig(process.env), String(t.order_name));
      if (storeCustomerId) {
        d.prepare(`UPDATE sim_customers SET store_customer_id = ? WHERE id = (SELECT customer_id FROM sim_tickets WHERE id = ?)`).run(storeCustomerId, ticketId);
      }
    } catch {}
  }
  if (!storeCustomerId) return empty("This customer has no simulated store account.");

  const cached = d.prepare(`SELECT * FROM store_snapshots WHERE ticket_id = ?`).get(ticketId) as Row | undefined;
  const age = cached ? (Date.now() - Date.parse(iso(cached.fetched_at)!)) / 1000 : Infinity;
  if (cached && age < FRESH_SECONDS && !opts.refresh) {
    return { available: true, reason: null, snapshot: JSON.parse(String(cached.data)), fetchedAt: iso(cached.fetched_at), stale: false, error: null, returns };
  }
  try {
    const snapshot = await fetchSnapshot(storeCustomerId, s(t.order_name));
    if (!snapshot) return empty("This customer isn't a simulated store customer.");
    d.prepare(
      `INSERT INTO store_snapshots (ticket_id, data, fetched_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT (ticket_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at, last_error = NULL, last_error_at = NULL`,
    ).run(ticketId, JSON.stringify(snapshot));
    return { available: true, reason: null, snapshot, fetchedAt: new Date().toISOString(), stale: false, error: null, returns };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Store lookup failed";
    if (cached) {
      d.prepare(`UPDATE store_snapshots SET last_error = ?, last_error_at = datetime('now') WHERE ticket_id = ?`).run(message.slice(0, 300), ticketId);
      return { available: true, reason: null, snapshot: JSON.parse(String(cached.data)), fetchedAt: iso(cached.fetched_at), stale: true, error: message, returns };
    }
    return { ...empty("The store couldn't be reached."), error: message };
  }
}
