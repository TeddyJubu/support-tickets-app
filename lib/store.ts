// Customer rail data from the connected Shopify store, cached per ticket. If Shopify is slow
// or down, the last successful read is shown with its age. Store data is only read for an
// email ticket from a verified sender, and only that sender's own customer record and orders;
// simulated tickets have none. Amounts Shopify doesn't return are null ("unavailable"), never 0.

import { createHash } from "node:crypto";
import { isoFromSql } from "./db";
import { getDb } from "./sim-db";
import { findCustomerIdByEmail, getCustomerWithOrders, getOrderForCustomer, shopifyConfig, type ShopifyConfig } from "./shopify";
import { storedConnection } from "./shopify-tokens";
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
  /** Not read from the store: shown as "unavailable" */
  storeCredit: null;
  giftCards: null;
}

export interface RailResponse {
  available: boolean;
  /** Why there's no store data (not connected, a simulated ticket, an unverified sender…) */
  reason: string | null;
  snapshot: StoreSnapshot | null;
  fetchedAt: string | null;
  /** The last refresh failed: showing an older read */
  stale: boolean;
  error: string | null;
  returns: SimReturn[];
}

type Row = Record<string, unknown>;
const iso = isoFromSql;

type Access =
  | { ok: true; config: ShopifyConfig; email: string; orderName: string | null }
  | { ok: false; reason: string; status: 403 | 404 | 503 };

/**
 * Whether a ticket's customer may be looked up in Shopify, and by which address. All of:
 * Shopify is connected; it's an email ticket from an email customer; the stored address still
 * hashes to the key the customer was filed under; the sender passed DMARC (or staff opened it).
 */
export function storeAccess(ticketId: string): Access {
  const t = getDb()
    .prepare(
      `SELECT t.channel, t.sender_verified, t.order_name, c.email, c.source_key FROM sim_tickets t
       LEFT JOIN sim_customers c ON c.id = t.customer_id WHERE t.id = ?`,
    )
    .get(ticketId) as Row | undefined;
  if (!t) return { ok: false, reason: "Ticket not found", status: 404 };
  const config = shopifyConfig();
  if (!config) {
    const reconnect = storedConnection()?.status === "reconnect";
    return { ok: false, reason: reconnect ? "The Shopify store needs reconnecting (Settings)." : "The Shopify store isn't connected.", status: 503 };
  }
  const key = String(t.source_key ?? "");
  if (t.channel !== "email" || !key.startsWith("email:")) return { ok: false, reason: "Simulated tickets have no store data.", status: 403 };
  const email = String(t.email ?? "").trim().toLowerCase();
  if (!email || createHash("sha256").update(email).digest("hex") !== key.slice("email:".length)) {
    return { ok: false, reason: "This customer's email address doesn't match their record, so store data isn't shown.", status: 403 };
  }
  if (t.sender_verified == null) {
    return { ok: false, reason: "This ticket arrived before senders were verified, so store data isn't shown.", status: 403 };
  }
  if (Number(t.sender_verified) !== 1) {
    return { ok: false, reason: "The sender couldn't be verified (the email failed DMARC), so store data isn't shown.", status: 403 };
  }
  return { ok: true, config, email, orderName: t.order_name == null ? null : String(t.order_name) };
}

const sameName = (a: string, b: string) => a.trim().replace(/^#/, "").toLowerCase() === b.trim().replace(/^#/, "").toLowerCase();
const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "#1001", "order 1001", "order no. 1001", "Order number: #1001"
const NUMBER_PREFIX = String.raw`(?:#|\border\s*(?:no\.?|number|num\.?)?\s*:?\s*#?)`;

/** Does the text mention this order? A bare number needs "#" or "order" in front of it. */
export function mentionsOrder(text: string, name: string) {
  const core = name.trim().replace(/^#/, "");
  if (!core) return false;
  const pattern = /^\d+$/.test(core) ? `${NUMBER_PREFIX}${escape(core)}(?!\\d)` : `(?<![a-z0-9])#?${escape(core)}(?![a-z0-9])`;
  return new RegExp(pattern, "i").test(text);
}

/** Order numbers written in the texts, in order of appearance */
function writtenOrderNumbers(texts: string[]) {
  const out: string[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(new RegExp(`${NUMBER_PREFIX}(\\d{3,10})(?!\\d)`, "gi"))) {
      if (!out.includes(`#${m[1]}`)) out.push(`#${m[1]}`);
    }
  }
  return out;
}

/** The ticket's messages, newest first, then its subject */
function ticketTexts(ticketId: string) {
  const d = getDb();
  const messages = d
    .prepare(`SELECT body FROM sim_messages WHERE ticket_id = ? AND author != 'system' ORDER BY id DESC LIMIT 50`)
    .all(ticketId) as Row[];
  const t = d.prepare(`SELECT subject FROM sim_tickets WHERE id = ?`).get(ticketId) as Row | undefined;
  return [...messages.map((m) => String(m.body ?? "")), String(t?.subject ?? "")];
}

/**
 * The order this ticket is about: the newest mention of one of the customer's recent orders,
 * else the order recorded on the ticket, else up to three other numbers the ticket mentions.
 * Every candidate is checked to belong to this customer.
 */
async function ticketOrder(ticketId: string, access: Extract<Access, { ok: true }>, customerId: string, recent: RailOrder[]) {
  const texts = ticketTexts(ticketId);
  for (const text of texts) {
    const hit = recent.find((o) => mentionsOrder(text, o.name));
    if (hit) return hit;
  }
  const candidates = [access.orderName, ...writtenOrderNumbers(texts)].filter((x): x is string => !!x);
  for (const name of candidates.filter((n, i) => candidates.findIndex((m) => sameName(m, n)) === i).slice(0, 3)) {
    const known = recent.find((o) => sameName(o.name, name));
    if (known) return known;
    const order = await getOrderForCustomer(access.config, customerId, name);
    if (order) return order;
  }
  return null;
}

async function fetchSnapshot(ticketId: string, access: Extract<Access, { ok: true }>): Promise<StoreSnapshot | null> {
  const id = await findCustomerIdByEmail(access.config, access.email);
  const customer = id ? await getCustomerWithOrders(access.config, id) : null;
  if (!customer) return null;
  const orders = customer.orders;
  const matchedOrder = await ticketOrder(ticketId, access, customer.id, orders);
  // An older order the ticket is about is listed with the recent ones
  if (matchedOrder && !orders.some((o) => o.name === matchedOrder.name)) orders.push(matchedOrder);
  return {
    customer: {
      name: customer.name,
      email: customer.email,
      location: customer.location,
      ordersCount: customer.ordersCount,
      totalSpent: customer.totalSpent,
      since: customer.since,
    },
    matchedOrder,
    orders,
    storeCredit: null,
    giftCards: null,
  };
}

const NO_CUSTOMER = "No customer in the Shopify store has this email address.";

export async function railForTicket(ticketId: string, opts: { refresh?: boolean } = {}): Promise<RailResponse | null> {
  const d = getDb();
  if (!d.prepare(`SELECT 1 FROM sim_tickets WHERE id = ?`).get(ticketId)) return null;
  const returns = returnsForTicket(ticketId);
  const empty = (reason: string): RailResponse => ({ available: false, reason, snapshot: null, fetchedAt: null, stale: false, error: null, returns });
  // Checked before the cache too: a later unverified message hides an earlier read
  const access = storeAccess(ticketId);
  if (!access.ok) return empty(access.reason);

  const cached = d.prepare(`SELECT * FROM store_snapshots WHERE ticket_id = ?`).get(ticketId) as Row | undefined;
  const age = cached ? (Date.now() - Date.parse(iso(cached.fetched_at)!)) / 1000 : Infinity;
  if (cached && age < FRESH_SECONDS && !opts.refresh) {
    return { available: true, reason: null, snapshot: JSON.parse(String(cached.data)), fetchedAt: iso(cached.fetched_at), stale: false, error: null, returns };
  }
  try {
    const snapshot = await fetchSnapshot(ticketId, access);
    if (!snapshot) {
      d.prepare(`DELETE FROM store_snapshots WHERE ticket_id = ?`).run(ticketId);
      return empty(NO_CUSTOMER);
    }
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
    // Shopify's error (status, sign-in or scope problem) never holds customer data
    return { ...empty(`The store couldn't be reached: ${message}`), error: message };
  }
}

export type OrderLookup =
  | { order: RailOrder }
  | { error: string; status: 400 | 403 | 404 | 502 | 503; recent?: Array<{ name: string; placedAt: string | null }> };

/**
 * One of the ticket's own customer's orders: by name, or (with no name) the order the ticket
 * is about. Never an older cached read: callers act on it.
 */
export async function orderForTicket(ticketId: string, name?: string | null): Promise<OrderLookup> {
  const access = storeAccess(ticketId);
  if (!access.ok) return { error: access.reason, status: access.status };
  const want = name?.trim() || null;
  if (want && !/^#?[A-Za-z0-9-]{1,40}$/.test(want)) return { error: "That isn't an order name", status: 400 };
  const rail = await railForTicket(ticketId);
  if (!rail || rail.stale || rail.error) return { error: `The store couldn't be reached${rail?.error ? `: ${rail.error}` : ""}`, status: 502 };
  if (!rail.snapshot) return { error: rail.reason ?? NO_CUSTOMER, status: 404 };
  const recent = rail.snapshot.orders.slice(0, 10).map((o) => ({ name: o.name, placedAt: o.placedAt }));
  if (!want) {
    if (rail.snapshot.matchedOrder) return { order: rail.snapshot.matchedOrder };
    return { error: "The ticket doesn't name one of this customer's orders.", status: 404, recent };
  }
  const known = rail.snapshot.orders.find((o) => sameName(o.name, want));
  if (known) return { order: known };
  try {
    const id = await findCustomerIdByEmail(access.config, access.email);
    const order = id ? await getOrderForCustomer(access.config, id, want) : null;
    return order ? { order } : { error: `Order ${want} isn't one of this customer's orders.`, status: 404, recent };
  } catch (err) {
    return { error: `The store couldn't be reached: ${err instanceof Error ? err.message : "lookup failed"}`, status: 502 };
  }
}
