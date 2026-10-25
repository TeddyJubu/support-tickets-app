// Connecting and disconnecting the Shopify store from Settings (owner only). The store installs
// this copy's Shopify app (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET) through Shopify's
// authorization code grant:
//   1. beginConnect: a signed 10-minute state cookie, then the browser goes to the store's
//      /admin/oauth/authorize page, where the owner approves the read-only scopes
//   2. Shopify sends the browser back to /api/shopify/callback. finishConnect checks Shopify's
//      HMAC, the state cookie and the shop, swaps the code for expiring keys and saves them
//      (lib/shopify-tokens.ts)
// disconnect uninstalls the app from the store and forgets the keys. That uninstall is the one
// write this app sends to Shopify, and it only removes the app's own access.
// Shopify's webhooks (the app was uninstalled, and the privacy requests every app must answer)
// arrive at /api/shopify/webhooks and are handled here.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { audit, type StaffUser } from "./auth";
import { transaction } from "./db";
import { createAlert, notifyOwners, siteUrl } from "./notify";
import { isHttps, readCookie } from "./request-auth";
import { getDb } from "./sim-db";
import { getState, setState } from "./worker/state";
import { normalizeShop, shopifyApiVersion, shopifyApp, shopifyConfig, shopifyQuery, shopPinned } from "./shopify";
import {
  deleteConnection,
  requestTokens,
  saveConnection,
  settingsAccessToken,
  storedConnection,
  type ShopifyApp,
  type ShopifyConnection,
  type TokenSet,
} from "./shopify-tokens";

export const STATE_COOKIE = "shopify_oauth";
const STATE_SECONDS = 600;
/** How far the timestamp on Shopify's redirect may be from this server's clock */
const REDIRECT_TOLERANCE_S = 300;
const BASE_SCOPES = ["read_customers", "read_orders"];

type Row = Record<string, unknown>;
type Failure = { ok: false; error: string; status: number };
type Result<T> = ({ ok: true } & T) | Failure;

const fail = (error: string, status: number): Failure => ({ ok: false, error, status });

export const callbackUrl = () => `${siteUrl()}/api/shopify/callback`;
export const webhookUrl = () => `${siteUrl()}/api/shopify/webhooks`;
/** The app's URL in Shopify: installing from Shopify lands here with ?shop= */
export const appUrl = () => `${siteUrl()}/settings`;

/** read_customers and read_orders, plus any other read_* scopes in SHOPIFY_SCOPES (e.g. read_all_orders) */
export function requiredScopes(env: Record<string, string | undefined> = process.env) {
  const extra = (env.SHOPIFY_SCOPES ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^read_[a-z_]+$/.test(x));
  return [...new Set([...BASE_SCOPES, ...extra])];
}

// A write scope includes its read scope
const granted = (scopes: string[], want: string) => scopes.includes(want) || scopes.includes(want.replace(/^read_/, "write_"));

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Why the owner can't connect or disconnect here, if they can't */
function manageBlocked(): Failure | null {
  if (shopPinned()) {
    return fail("SHOPIFY_SHOP in .env.local fixes the store, so it can't be changed here. Remove it and restart to connect a store from Settings.", 409);
  }
  if (!shopifyApp()) return fail("Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env.local first (Settings shows how).", 409);
  return null;
}

// --- Connect

// Binds the state to the shop, the owner who started it and its expiry
const stateSig = (secret: string, state: string, shop: string, exp: number, userId: number) =>
  createHmac("sha256", secret).update(`shopify-oauth.${state}.${shop}.${exp}.${userId}`).digest("base64url");

function stateCookie(request: Request, value: string, maxAge: number) {
  return [`${STATE_COOKIE}=${value}`, "Path=/api/shopify", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`, ...(isHttps(request) ? ["Secure"] : [])].join("; ");
}

export const clearStateCookie = (request: Request) => stateCookie(request, "", 0);

/** Where to send the owner's browser to approve the app, and the state cookie to set first */
export function beginConnect(request: Request, user: StaffUser, input: unknown): Result<{ shop: string; url: string; cookie: string }> {
  const blocked = manageBlocked();
  if (blocked) return blocked;
  const app = shopifyApp() as ShopifyApp;
  const shop = normalizeShop(typeof input === "string" ? input : "");
  if (!shop) return fail("Enter the store's myshopify address, like cute-things.myshopify.com.", 400);
  const state = randomBytes(24).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + STATE_SECONDS;
  const value = `${state}.${shop}.${exp}.${stateSig(app.clientSecret, state, shop, exp, user.id)}`;
  // No grant_options[]=per-user: an offline token, so the worker can use it too
  const url = new URL(`https://${shop}.myshopify.com/admin/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: app.clientId, scope: requiredScopes().join(","), redirect_uri: callbackUrl(), state }).toString();
  return { ok: true, shop, url: url.toString(), cookie: stateCookie(request, value, STATE_SECONDS) };
}

/** Shopify's signature on a redirect to this site: the other parameters, sorted, keyed with the app secret */
export function validRedirectHmac(params: URLSearchParams, secret: string) {
  const rest = [...params].filter(([k]) => k !== "hmac" && k !== "signature").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const expected = createHmac("sha256", secret).update(new URLSearchParams(rest).toString()).digest("hex");
  return safeEqual((params.get("hmac") ?? "").toLowerCase(), expected);
}

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Shopify's redirect back after the owner approved: check it, then save the store's keys */
export async function finishConnect(request: Request, user: StaffUser): Promise<Result<{ shop: string; shopName: string | null }>> {
  const blocked = manageBlocked();
  if (blocked) return blocked;
  const app = shopifyApp() as ShopifyApp;
  const params = new URL(request.url).searchParams;
  if (!validRedirectHmac(params, app.clientSecret)) return fail("Shopify's signature on the sign-in didn't match. Start again from Settings.", 400);
  const now = Math.floor(Date.now() / 1000);
  if (!(Math.abs(now - Number(params.get("timestamp"))) <= REDIRECT_TOLERANCE_S)) return fail("The sign-in link had expired. Start again from Settings.", 400);
  const domain = params.get("shop") ?? "";
  const shop = SHOP_DOMAIN.test(domain) ? normalizeShop(domain) : null;
  const [state, cookieShop, exp, sig] = (readCookie(request, STATE_COOKIE) ?? "").split(".");
  const ours =
    !!shop &&
    !!state &&
    state === params.get("state") &&
    cookieShop === shop &&
    Number(exp) >= now &&
    safeEqual(sig ?? "", stateSig(app.clientSecret, state, shop, Number(exp), user.id));
  if (!shop || !ours) return fail("This sign-in wasn't started here, or took longer than 10 minutes. Start again from Settings.", 400);
  const code = params.get("code");
  if (!code) return fail("Shopify didn't send a sign-in code. Start again from Settings.", 400);

  let tokens: TokenSet;
  try {
    // expiring=1: hour-long keys plus a refresh key, which Shopify requires of public apps
    tokens = await requestTokens(shop, { client_id: app.clientId, client_secret: app.clientSecret, code, expiring: "1" });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Shopify sign-in failed", 502);
  }
  const missing = requiredScopes().filter((s) => !granted(tokens.scopes, s));
  if (missing.length) {
    return fail(`The store didn't grant ${missing.join(", ")}. Add it to the app's scopes in Shopify's Dev Dashboard, then connect again.`, 400);
  }
  let shopName: string | null = null;
  try {
    const data = await shopifyQuery<{ shop?: { name?: string | null } }>(
      { shop, apiVersion: shopifyApiVersion(), clientId: null, clientSecret: null, adminToken: tokens.accessToken, source: "settings" },
      `query ShopName { shop { name } }`,
    );
    shopName = data.shop?.name?.trim().slice(0, 120) || null;
  } catch {
    // The name is only for display
  }
  const d = getDb();
  transaction(d, () => {
    saveConnection(shop, shopName, tokens, user.username);
    // Cached reads came from the previous store (or connection)
    d.prepare(`DELETE FROM store_snapshots`).run();
  });
  audit(user.username, "shopify_connect", null, { shop, scopes: tokens.scopes });
  return { ok: true, shop, shopName };
}

// --- Disconnect

// The only write this app sends to Shopify: removing its own access to the store
const UNINSTALL = `mutation AppUninstall { appUninstall { app { id } userErrors { field message } } }`;

async function uninstallApp(app: ShopifyApp, shop: string): Promise<boolean> {
  const token = await settingsAccessToken(app);
  const res = await fetch(`https://${shop}.myshopify.com/admin/api/${shopifyApiVersion()}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-shopify-access-token": token },
    body: JSON.stringify({ query: UNINSTALL }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { data?: { appUninstall?: { userErrors?: unknown[] } }; errors?: unknown } | null;
  const errors = body?.data?.appUninstall?.userErrors;
  return res.ok && !body?.errors && Array.isArray(errors) && errors.length === 0;
}

/**
 * Uninstalls the app from the store (best effort) and forgets the keys and cached store data.
 * uninstalled: false means the app may still be listed in the store's admin (Settings → Apps).
 */
export async function disconnect(user: StaffUser): Promise<Result<{ shop: string | null; uninstalled: boolean }>> {
  if (shopPinned()) return manageBlocked() as Failure;
  const saved = storedConnection();
  if (!saved) return { ok: true, shop: null, uninstalled: false };
  const app = shopifyApp();
  const uninstalled = app && saved.status === "connected" ? await uninstallApp(app, saved.shop).catch(() => false) : false;
  const d = getDb();
  transaction(d, () => {
    deleteConnection();
    d.prepare(`DELETE FROM store_snapshots`).run();
  });
  audit(user.username, "shopify_disconnect", null, { shop: saved.shop, uninstalled });
  return { ok: true, shop: saved.shop, uninstalled };
}

// --- Status (no keys)

export interface ShopifyStatus {
  canManage: boolean;
  appConfigured: boolean;
  /** SHOPIFY_SHOP in .env.local: this store, and Settings can't change it */
  pinnedShop: string | null;
  /** Store lookups are set up (Shopify may still refuse them) */
  active: boolean;
  connection: ShopifyConnection | null;
  /** Most recent successful shop-metadata connection check for this connection */
  lastSuccessfulCheckAt: string | null;
  /** What the app needs in Shopify's Dev Dashboard */
  setup: { appUrl: string; redirectUrl: string; webhookUrl: string; scopes: string[] };
}

export function shopifyStatus(user: StaffUser): ShopifyStatus {
  const pinnedShop = shopPinned() ? normalizeShop(process.env.SHOPIFY_SHOP) ?? process.env.SHOPIFY_SHOP?.trim() ?? null : null;
  const connection = pinnedShop ? null : storedConnection();
  const config = shopifyConfig();
  const previousCheck = getState<{ shop?: string; connectedAt?: string | null }>("shopify_connection_check");
  const checkMatches = !!config && previousCheck?.value.shop === config.shop &&
    (config.source === "settings" ? (previousCheck.value.connectedAt ?? null) === (connection?.connectedAt ?? null) : previousCheck.value.connectedAt == null);
  return {
    canManage: user.role === "owner",
    appConfigured: !!shopifyApp(),
    pinnedShop,
    active: !!config,
    connection,
    lastSuccessfulCheckAt: checkMatches ? previousCheck?.updatedAt ?? null : null,
    setup: { appUrl: appUrl(), redirectUrl: callbackUrl(), webhookUrl: webhookUrl(), scopes: requiredScopes() },
  };
}

/** Authenticated, read-only check of Shopify shop metadata; never queries customers or orders. */
export async function checkShopifyConnection() {
  const config = shopifyConfig();
  if (!config) throw new Error("No active Shopify store connection is available to check.");
  const data = await shopifyQuery<{ shop?: { name?: string | null } | null }>(config, `query HelpdeskConnectionCheck { shop { name } }`);
  if (!data.shop) throw new Error("Shopify didn't return shop metadata.");
  const connection = config.source === "settings" ? storedConnection() : null;
  setState("shopify_connection_check", { shop: config.shop, connectedAt: connection?.connectedAt ?? null });
  return { shop: config.shop, shopName: data.shop.name?.trim().slice(0, 120) || null, checkedAt: new Date().toISOString() };
}

// --- Webhooks

/** X-Shopify-Hmac-Sha256: the raw body keyed with the app secret, base64 */
export function validWebhookHmac(raw: Buffer, given: string | null, secret: string) {
  return safeEqual(given ?? "", createHmac("sha256", secret).update(raw).digest("base64"));
}

export interface ShopifyWebhook {
  /** X-Shopify-Webhook-Id: Shopify may deliver the same one more than once */
  id: string;
  topic: string;
  shopDomain: string;
  /** X-Shopify-Triggered-At */
  triggeredAt: string | null;
  payload: Row | null;
}

/** The store whose data this copy holds: the pinned one, else the one connected in Settings */
function currentShop() {
  return shopPinned() ? normalizeShop(process.env.SHOPIFY_SHOP) : storedConnection()?.shop ?? null;
}

/** Helpdesk tickets from this email address (customers are filed under a hash of it) */
function ticketsForEmail(email: unknown): string[] {
  const address = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!address) return [];
  const key = `email:${createHash("sha256").update(address).digest("hex")}`;
  const rows = getDb()
    .prepare(`SELECT t.id FROM sim_tickets t JOIN sim_customers c ON c.id = t.customer_id WHERE c.source_key = ? ORDER BY t.seq`)
    .all(key) as Row[];
  return rows.map((r) => String(r.id));
}

const ticketList = (ids: string[]) => (ids.length > 10 ? `${ids.slice(0, 10).join(", ")} and ${ids.length - 10} more` : ids.join(", "));

/**
 * Acts on one verified webhook. Alerts and notifications name the store and ticket IDs only,
 * never customer details.
 */
export function handleWebhook(w: ShopifyWebhook): "handled" | "duplicate" | "ignored" {
  const d = getDb();
  const shop = normalizeShop(w.shopDomain);
  return transaction(d, () => {
    const fresh = d.prepare(`INSERT OR IGNORE INTO shopify_webhooks (id, topic, shop) VALUES (?, ?, ?)`).run(w.id.slice(0, 200), w.topic.slice(0, 60), shop);
    if (fresh.changes === 0) return "duplicate";
    d.prepare(`DELETE FROM shopify_webhooks WHERE received_at < datetime('now', '-30 days')`).run();
    const current = currentShop();
    const customer = (w.payload?.customer ?? null) as Row | null;

    switch (w.topic) {
      case "app/uninstalled": {
        if (!shop || shop !== current) return "ignored";
        const stored = storedConnection();
        const saved = stored?.shop === shop ? stored : null;
        // Connected again since the uninstall: that connection is a new one
        const at = Date.parse(w.triggeredAt ?? "");
        if (saved && Number.isFinite(at) && Date.parse(saved.connectedAt ?? "") > at) return "ignored";
        if (saved) deleteConnection();
        d.prepare(`DELETE FROM store_snapshots`).run();
        createAlert(d, {
          kind: "shopify",
          subject: "[Helpdesk] The Shopify store removed the app",
          body: `${shop}.myshopify.com uninstalled the helpdesk's Shopify app, so customer and order lookups are off${saved ? " and the saved keys were deleted" : ""}.\n\nTo connect it again: ${siteUrl()}/settings`,
          dedupeKey: `shopify:uninstalled:${w.id}`,
        });
        notifyOwners(d, "alert", null, `${shop}.myshopify.com removed the helpdesk's Shopify app, so store lookups are off. Reconnect it in Settings.`);
        return "handled";
      }
      case "customers/redact": {
        // Store data is read live; only the per-ticket cache holds any. The customer's own
        // emails to support stay: the owner decides about those
        const tickets = ticketsForEmail(customer?.email);
        if (!tickets.length) return "handled";
        const marks = tickets.map(() => "?").join(", ");
        d.prepare(`DELETE FROM store_snapshots WHERE ticket_id IN (${marks})`).run(...tickets);
        notifyOwners(
          d,
          "alert",
          null,
          `Shopify asked to erase a customer's data. Their cached store details were deleted; their support tickets were kept: ${ticketList(tickets)}.`,
        );
        return "handled";
      }
      case "customers/data_request": {
        const tickets = ticketsForEmail(customer?.email);
        if (!tickets.length) return "handled";
        const request = String((w.payload?.data_request as Row | undefined)?.id ?? "").slice(0, 40);
        createAlert(d, {
          kind: "shopify",
          subject: "[Helpdesk] A customer asked Shopify for their data",
          body: `Shopify passed on a customer's request for the data apps hold about them${request ? ` (request ${request})` : ""}.\n\nThe helpdesk has their support tickets: ${ticketList(tickets)}.\n\nOpen them at ${siteUrl()} and send the customer what's needed within 30 days.`,
          dedupeKey: `shopify:data_request:${w.id}`,
        });
        notifyOwners(d, "alert", null, `A customer asked Shopify for their data. Their support tickets: ${ticketList(tickets)}.`);
        return "handled";
      }
      case "shop/redact": {
        // Sent 48 hours after an uninstall
        if (!shop) return "ignored";
        const saved = storedConnection();
        if (saved?.shop === shop && saved.status !== "connected") deleteConnection();
        if (current === null || current === shop) d.prepare(`DELETE FROM store_snapshots`).run();
        return "handled";
      }
      default:
        return "ignored";
    }
  });
}
