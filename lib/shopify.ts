// Read-only client for the store's Shopify Admin GraphQL API. Only queries go out: anything
// that looks like a mutation is refused before it's sent (the one exception, uninstalling the
// app on Disconnect, is in lib/shopify-connect.ts). Callers are always scoped to one customer
// (lib/store.ts decides who may be looked up). Runs only on the server.
//
// Which store:
//   Settings (the usual way)  the owner connects any store in Settings → Shopify store
//                             (lib/shopify-connect.ts); needs SHOPIFY_CLIENT_ID +
//                             SHOPIFY_CLIENT_SECRET, the app the store installs. Its keys are
//                             in sim.db (lib/shopify-tokens.ts).
//   SHOPIFY_SHOP in .env.local pins one store (the myshopify subdomain, e.g. cute-things),
//                             and Settings can't change it. With it, either
//     SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET  an app in the same Dev Dashboard org as the
//                                                store; 24-hour client credentials tokens
//     SHOPIFY_ADMIN_TOKEN                        a fixed Admin API token, used as is
// Optional: SHOPIFY_API_VERSION (default 2026-10).
// Scopes: read_customers, read_orders (read_all_orders for orders older than 60 days), and
// protected customer data access for names and email addresses.

import type { RailOrder } from "./store";
import { settingsAccessToken, storedConnection, type ShopifyApp } from "./shopify-tokens";

export const DEFAULT_API_VERSION = "2026-10";
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

export interface ShopifyConfig {
  /** The myshopify subdomain (cute-things) */
  shop: string;
  apiVersion: string;
  clientId: string | null;
  clientSecret: string | null;
  adminToken: string | null;
  /** env: pinned by SHOPIFY_SHOP; settings: connected by the owner in Settings */
  source: "env" | "settings";
}

/** "Cute-Things.myshopify.com", "https://cute-things.myshopify.com/" or "cute-things" → "cute-things"; null if it isn't one */
export function normalizeShop(input: string | null | undefined): string | null {
  const shop = (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/\.myshopify\.com$/, "");
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(shop) ? shop : null;
}

/** The Shopify app this copy signs in as, if its credentials are set */
export function shopifyApp(env: Record<string, string | undefined> = process.env): ShopifyApp | null {
  const clientId = env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = env.SHOPIFY_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** SHOPIFY_SHOP is set: the store is fixed in .env.local, not chosen in Settings */
export const shopPinned = (env: Record<string, string | undefined> = process.env) => !!env.SHOPIFY_SHOP?.trim();

export function shopifyApiVersion(env: Record<string, string | undefined> = process.env) {
  const version = env.SHOPIFY_API_VERSION?.trim() ?? "";
  return /^\d{4}-\d{2}$/.test(version) ? version : DEFAULT_API_VERSION;
}

export function shopifyConfig(env: Record<string, string | undefined> = process.env): ShopifyConfig | null {
  const apiVersion = shopifyApiVersion(env);
  const app = shopifyApp(env);
  if (shopPinned(env)) {
    const shop = normalizeShop(env.SHOPIFY_SHOP);
    const adminToken = env.SHOPIFY_ADMIN_TOKEN?.trim() || null;
    if (!shop || (!adminToken && !app)) return null;
    return { shop, apiVersion, clientId: app?.clientId ?? null, clientSecret: app?.clientSecret ?? null, adminToken, source: "env" };
  }
  const saved = app ? storedConnection() : null;
  if (!app || saved?.status !== "connected") return null;
  return { shop: saved.shop, apiVersion, clientId: app.clientId, clientSecret: app.clientSecret, adminToken: null, source: "settings" };
}

// Client credentials tokens (a pinned store) last 24 hours; one is kept in memory and replaced 5 minutes early
let token: { key: string; value: string; expiresAt: number } | null = null;

// refused: the token Shopify just turned down, so a new one is needed
async function accessToken(config: ShopifyConfig, refused: string | null): Promise<string> {
  if (config.adminToken) return config.adminToken;
  if (config.source === "settings") return settingsAccessToken({ clientId: config.clientId ?? "", clientSecret: config.clientSecret ?? "" }, refused);
  const key = `${config.shop}:${config.clientId}`;
  if (!refused && token?.key === key && token.expiresAt - Date.now() > 5 * 60_000) return token.value;
  const res = await fetch(`https://${config.shop}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || typeof body?.access_token !== "string") {
    // Shopify's own error code only (e.g. shop_not_permitted), never the request
    const why = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(`Shopify sign-in failed: ${why.slice(0, 120)}`);
  }
  token = { key, value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** Forget the cached token (tests) */
export function resetShopifyToken() {
  token = null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GraphQLBody {
  data?: unknown;
  /** A list for GraphQL errors; a plain string for some HTTP errors (401, 429) */
  errors?: Array<{ message?: string; extensions?: { code?: string } }> | string;
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } };
}

/** How long to wait before retrying a throttled request (capped: a person is waiting) */
function retryDelay(res: Response, body: GraphQLBody | null, attempt: number) {
  const after = Number(res.headers.get("retry-after"));
  if (Number.isFinite(after) && res.headers.has("retry-after")) return Math.min(2000, Math.max(0, after * 1000));
  const cost = body?.extensions?.cost;
  const status = cost?.throttleStatus;
  if (status?.restoreRate) {
    const missing = (cost?.requestedQueryCost ?? 0) - (status.currentlyAvailable ?? 0);
    return Math.min(2000, Math.max(0, Math.ceil((missing / status.restoreRate) * 1000)));
  }
  return Math.min(2000, 250 * 2 ** attempt);
}

/** Run one read query. Throws on HTTP, GraphQL (even in a 200) and sign-in errors. */
export async function shopifyQuery<T>(config: ShopifyConfig, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (/\b(mutation|subscription)\b/i.test(query)) throw new Error("Only read queries can be sent to Shopify");
  let refused: string | null = null;
  let renewed = false;
  for (let attempt = 0; ; attempt++) {
    const used = await accessToken(config, refused);
    refused = null;
    const res = await fetch(`https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-shopify-access-token": used,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as GraphQLBody | null;
    const last = attempt + 1 >= MAX_ATTEMPTS;
    // An expired or revoked token: get a new one once
    if (res.status === 401 && !config.adminToken && !renewed) {
      renewed = true;
      refused = used;
      continue;
    }
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    const throttled = res.status === 429 || errors.some((e) => e.extensions?.code === "THROTTLED");
    if ((throttled || res.status >= 500) && !last) {
      await sleep(retryDelay(res, body, attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Shopify: HTTP ${res.status}${throttled ? " (rate limited)" : ""}`);
    if (errors.length) throw new Error(`Shopify: ${String(errors[0].message ?? "query failed").slice(0, 200)}`);
    if (!body?.data) throw new Error("Shopify: empty response");
    return body.data as T;
  }
}

// Preview five products per order to bound the initial query cost.
// The ticket-scoped order lookup loads the remaining products on request.
const LINE_ITEM_FIELDS = `
  title quantity sku variantTitle
  image { url(transform: { maxWidth: 240, maxHeight: 240 }) altText }
  originalUnitPriceSet { shopMoney { amount } }
  discountedTotalSet(withCodeDiscounts: true) { shopMoney { amount } }
`;

const ORDER_FIELDS = `
  id
  name
  createdAt
  cancelledAt
  displayFinancialStatus
  displayFulfillmentStatus
  currencyCode
  totalPriceSet { shopMoney { amount currencyCode } }
  subtotalPriceSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  totalTaxSet { shopMoney { amount } }
  totalDiscountsSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount } }
  customer { id }
  lineItems(first: 5) { pageInfo { hasNextPage endCursor } nodes { ${LINE_ITEM_FIELDS} } }
  fulfillments(first: 5) { status displayStatus createdAt trackingInfo(first: 2) { company number } }
  refunds(first: 5) { createdAt note totalRefundedSet { shopMoney { amount } } }
`;

const CUSTOMER_ID_BY_EMAIL = `query CustomerByEmail($query: String!) {
  customers(first: 5, query: $query) { nodes { id defaultEmailAddress { emailAddress } } }
}`;

const CUSTOMER_WITH_ORDERS = `query CustomerWithOrders($id: ID!) {
  customer(id: $id) {
    id
    firstName
    lastName
    defaultEmailAddress { emailAddress }
    defaultPhoneNumber { phoneNumber }
    defaultAddress { city provinceCode countryCodeV2 }
    numberOfOrders
    amountSpent { amount currencyCode }
    createdAt
    orders(first: 10, sortKey: CREATED_AT, reverse: true) { pageInfo { hasNextPage } nodes { ${ORDER_FIELDS} } }
  }
}`;

const ORDERS_BY_NAME = `query OrdersByName($query: String!) {
  orders(first: 5, query: $query) { nodes { ${ORDER_FIELDS} } }
}`;

const ORDER_ITEMS = `query OrderItems($id: ID!, $cursor: String!) {
  order(id: $id) {
    name customer { id }
    lineItems(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { ${LINE_ITEM_FIELDS} } }
  }
}`;

type Money = { amount?: string | null; currencyCode?: string | null } | null | undefined;
type LineItemNode = {
  title?: string | null;
  quantity?: number | null;
  sku?: string | null;
  variantTitle?: string | null;
  image?: { url?: string | null; altText?: string | null } | null;
  originalUnitPriceSet?: { shopMoney?: Money } | null;
  discountedTotalSet?: { shopMoney?: Money } | null;
};
type OrderNode = {
  id?: string;
  name: string;
  createdAt?: string | null;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currencyCode?: string | null;
  totalPriceSet?: { shopMoney?: Money } | null;
  customer?: { id?: string | null } | null;
  subtotalPriceSet?: { shopMoney?: Money } | null;
  totalShippingPriceSet?: { shopMoney?: Money } | null;
  totalTaxSet?: { shopMoney?: Money } | null;
  totalDiscountsSet?: { shopMoney?: Money } | null;
  totalRefundedSet?: { shopMoney?: Money } | null;
  lineItems?: { nodes?: LineItemNode[]; pageInfo?: { hasNextPage: boolean; endCursor?: string | null } };
  fulfillments?: Array<{ status?: string | null; displayStatus?: string | null; createdAt?: string | null; trackingInfo?: Array<{ company?: string | null; number?: string | null }> }>;
  refunds?: Array<{ createdAt?: string | null; note?: string | null; totalRefundedSet?: { shopMoney?: Money } | null }>;
};
type CustomerNode = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  defaultEmailAddress?: { emailAddress?: string | null } | null;
  defaultPhoneNumber?: { phoneNumber?: string | null } | null;
  defaultAddress?: { city?: string | null; provinceCode?: string | null; countryCodeV2?: string | null } | null;
  numberOfOrders?: string | number | null;
  amountSpent?: Money;
  createdAt?: string | null;
  orders?: { nodes?: OrderNode[]; pageInfo?: { hasNextPage: boolean } };
};

const n = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const s = (v: unknown) => (v == null || v === "" ? null : String(v));
/** PARTIALLY_REFUNDED → "partially refunded", the wording the panel shows */
const label = (v: unknown) => (v == null || v === "" ? null : String(v).toLowerCase().replace(/_/g, " "));

export function toRailOrder(o: OrderNode): RailOrder {
  const refunds = (o.refunds ?? []).map((r) => ({ amount: n(r.totalRefundedSet?.shopMoney?.amount), note: s(r.note), at: s(r.createdAt) }));
  return {
    name: String(o.name),
    placedAt: s(o.createdAt),
    total: n(o.totalPriceSet?.shopMoney?.amount),
    currency: s(o.totalPriceSet?.shopMoney?.currencyCode ?? o.currencyCode),
    payment: label(o.displayFinancialStatus),
    fulfillment: label(o.displayFulfillmentStatus),
    cancelledAt: s(o.cancelledAt),
    subtotal: n(o.subtotalPriceSet?.shopMoney?.amount),
    shipping: n(o.totalShippingPriceSet?.shopMoney?.amount),
    tax: n(o.totalTaxSet?.shopMoney?.amount),
    discounts: n(o.totalDiscountsSet?.shopMoney?.amount),
    itemsTruncated: o.lineItems?.pageInfo?.hasNextPage ?? false,
    items: (o.lineItems?.nodes ?? []).map((l) => ({
      title: String(l.title ?? ""),
      quantity: Number(l.quantity ?? 1),
      price: n(l.originalUnitPriceSet?.shopMoney?.amount),
      sku: s(l.sku),
      variant: s(l.variantTitle),
      image: l.image?.url && /^https:\/\//i.test(l.image.url) ? { url: l.image.url, alt: s(l.image.altText) } : null,
      lineTotal: n(l.discountedTotalSet?.shopMoney?.amount),
    })),
    shipments: (o.fulfillments ?? []).map((f) => ({
      status: label(f.status),
      carrier: s(f.trackingInfo?.[0]?.company),
      tracking: s(f.trackingInfo?.[0]?.number),
      shipmentStatus: label(f.displayStatus),
    })),
    refunds,
    // One refund with an unknown amount makes the total unknown ("unavailable"), never $0
    refunded: "totalRefundedSet" in o ? n(o.totalRefundedSet?.shopMoney?.amount) : refunds.some((r) => r.amount === null) ? null : refunds.reduce((sum, r) => sum + (r.amount ?? 0), 0),
  };
}

// Search values are quoted; anything that could break out of the quotes is refused instead
const searchable = (v: string) => /^[^\s"\\]{1,254}$/.test(v);
const sameName = (a: string, b: string) => a.trim().replace(/^#/, "").toLowerCase() === b.trim().replace(/^#/, "").toLowerCase();

export interface ShopifyCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  currency: string | null;
  ordersTruncated: boolean;
  location: string | null;
  ordersCount: number | null;
  totalSpent: number | null;
  since: string | null;
  /** Newest first, at most 10 */
  orders: RailOrder[];
}

/** The Shopify customer whose email is exactly this address (case-insensitive), or null */
export async function findCustomerIdByEmail(config: ShopifyConfig, email: string): Promise<string | null> {
  const want = email.trim().toLowerCase();
  if (!searchable(want) || !want.includes("@")) return null;
  const data = await shopifyQuery<{ customers?: { nodes?: CustomerNode[] } }>(config, CUSTOMER_ID_BY_EMAIL, { query: `email:"${want}"` });
  // Shopify's search is fuzzy: only an exact address counts
  const match = (data.customers?.nodes ?? []).filter((c) => c.defaultEmailAddress?.emailAddress?.trim().toLowerCase() === want);
  return match.length === 1 ? match[0].id : null;
}

export async function getCustomerWithOrders(config: ShopifyConfig, customerId: string): Promise<ShopifyCustomer | null> {
  const data = await shopifyQuery<{ customer?: CustomerNode | null }>(config, CUSTOMER_WITH_ORDERS, { id: customerId });
  const c = data.customer;
  if (!c || c.id !== customerId) return null;
  const email = s(c.defaultEmailAddress?.emailAddress);
  return {
    id: c.id,
    name: [c.firstName, c.lastName].filter(Boolean).join(" ") || email || "Customer",
    email,
    phone: s(c.defaultPhoneNumber?.phoneNumber),
    currency: s(c.amountSpent?.currencyCode),
    ordersTruncated: c.orders?.pageInfo?.hasNextPage ?? false,
    location: [c.defaultAddress?.city, c.defaultAddress?.provinceCode, c.defaultAddress?.countryCodeV2].filter(Boolean).join(", ") || null,
    ordersCount: n(c.numberOfOrders),
    totalSpent: n(c.amountSpent?.amount),
    since: s(c.createdAt),
    orders: (c.orders?.nodes ?? []).filter((o) => o.customer?.id === c.id).map(toRailOrder),
  };
}

/** An order by name, only if it belongs to this customer; otherwise null */
export async function getOrderForCustomer(config: ShopifyConfig, customerId: string, name: string): Promise<RailOrder | null> {
  const want = name.trim();
  if (!searchable(want) || want.length > 40) return null;
  const data = await shopifyQuery<{ orders?: { nodes?: OrderNode[] } }>(config, ORDERS_BY_NAME, { query: `name:"${want}"` });
  const order = (data.orders?.nodes ?? []).find((o) => sameName(o.name, want) && o.customer?.id === customerId);
  if (!order) return null;
  // Only paginate an order after its ownership was checked. Each subsequent page
  // is checked again before its products can enter the ticket's response.
  for (let page = 0; order.id && order.lineItems?.pageInfo?.hasNextPage && page < 10; page++) {
    const cursor = order.lineItems.pageInfo.endCursor;
    if (!cursor) break;
    const next = await shopifyQuery<{ order?: OrderNode | null }>(config, ORDER_ITEMS, { id: order.id, cursor });
    if (!next.order || next.order.customer?.id !== customerId || !sameName(next.order.name, want)) return null;
    const connection = next.order.lineItems;
    order.lineItems = { nodes: [...(order.lineItems.nodes ?? []), ...(connection?.nodes ?? [])], pageInfo: connection?.pageInfo };
    if (connection?.pageInfo?.endCursor === cursor) break;
  }
  return toRailOrder(order);
}
