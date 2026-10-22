// Keys for the store connected from Settings (lib/shopify-connect.ts). Kept in sim.db,
// encrypted (AES-256-GCM) with a key in data/shopify-token.key. Backups carry sim.db but not
// that key, so a restored copy asks for a reconnect instead of holding readable keys.
// Access tokens expire after an hour; the refresh token (90 days) buys a new pair, and the
// old refresh token then stops working. The web server and the worker share one row, so a
// short lease keeps two processes from spending the same refresh token.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { linkSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, isoFromSql, transaction } from "./db";
import { createAlert, notifyOwners, siteUrl } from "./notify";
import { getDb } from "./sim-db";

const TIMEOUT_MS = 10_000;
/** Longer than a refresh with its one retry */
const LEASE_MS = 25_000;
/** Refresh this long before Shopify's expiry */
const EARLY_MS = 60_000;

type Row = Record<string, unknown>;

/** The Shopify app this copy signs in as (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET) */
export interface ShopifyApp {
  clientId: string;
  clientSecret: string;
}

export interface TokenError extends Error {
  /** Shopify turned the request down (not a timeout, network or server error) */
  refused: boolean;
}

const tokenError = (message: string, refused: boolean): TokenError => Object.assign(new Error(message), { refused });

// --- Encryption

const keyPath = () => join(/*turbopackIgnore: true*/ dataDir(), "shopify-token.key");

function readKey(): Buffer | null {
  try {
    const key = Buffer.from(readFileSync(keyPath(), "utf8").trim(), "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function tokenKey(): Buffer {
  const existing = readKey();
  if (existing) return existing;
  // Written aside, then linked into place: another process never reads a half-written key,
  // and if one created it first, theirs is kept
  const tmp = `${keyPath()}.${process.pid}.${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, randomBytes(32).toString("base64"), { mode: 0o600 });
  try {
    linkSync(tmp, keyPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  } finally {
    rmSync(tmp, { force: true });
  }
  const key = readKey();
  if (!key) throw new Error(`${keyPath()} isn't a valid key`);
  return key;
}

// The shop is authenticated with the token, so a token can't be moved to another store's row
function seal(plain: string, shop: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  cipher.setAAD(Buffer.from(shop));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", ...[iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64url"))].join(".");
}

/** The token, or null if it can't be read here (no key, another server's key, damaged) */
function unseal(sealed: unknown, shop: string): string | null {
  const parts = typeof sealed === "string" ? sealed.split(".") : [];
  const key = readKey();
  if (parts.length !== 4 || parts[0] !== "v1" || !key) return null;
  try {
    const [iv, tag, ct] = parts.slice(1).map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(shop));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// --- The saved connection

export interface ShopifyConnection {
  /** The myshopify subdomain (cute-things) */
  shop: string;
  shopName: string | null;
  scopes: string[];
  /** reconnect: Shopify refused the keys, or they can't be read on this server */
  status: "connected" | "reconnect";
  lastError: string | null;
  connectedBy: string | null;
  connectedAt: string | null;
  /** Unused this long, the connection lapses (each refresh extends it) */
  lapsesAt: string | null;
}

const splitScopes = (v: unknown) =>
  String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** The saved store, without its keys */
export function storedConnection(): ShopifyConnection | null {
  const r = getDb().prepare(`SELECT * FROM shopify_connection WHERE id = 1`).get() as Row | undefined;
  if (!r) return null;
  return {
    shop: String(r.shop),
    shopName: r.shop_name == null ? null : String(r.shop_name),
    scopes: splitScopes(r.scopes),
    status: r.status === "connected" ? "connected" : "reconnect",
    lastError: r.last_error == null ? null : String(r.last_error),
    connectedBy: r.connected_by == null ? null : String(r.connected_by),
    connectedAt: isoFromSql(r.connected_at),
    lapsesAt: r.refresh_expires_at == null ? null : new Date(Number(r.refresh_expires_at)).toISOString(),
  };
}

export interface TokenSet {
  accessToken: string;
  /** ms since epoch; null for a token that doesn't expire */
  accessExpiresAt: number | null;
  refreshToken: string | null;
  refreshExpiresAt: number | null;
  scopes: string[];
}

/** Replaces any saved store */
export function saveConnection(shop: string, shopName: string | null, tokens: TokenSet, connectedBy: string) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO shopify_connection (id, shop, shop_name, scopes, status, access_token, access_expires_at,
         refresh_token, refresh_expires_at, refreshing_until, last_error, connected_by, connected_at, updated_at)
       VALUES (1, ?, ?, ?, 'connected', ?, ?, ?, ?, NULL, NULL, ?, datetime('now'), datetime('now'))`,
    )
    .run(
      shop,
      shopName,
      tokens.scopes.join(","),
      seal(tokens.accessToken, shop),
      tokens.accessExpiresAt,
      tokens.refreshToken ? seal(tokens.refreshToken, shop) : null,
      tokens.refreshExpiresAt,
      connectedBy,
    );
}

/** Forgets the saved store and its keys; returns the shop it was, if any */
export function deleteConnection(): string | null {
  const d = getDb();
  const r = d.prepare(`SELECT shop FROM shopify_connection WHERE id = 1`).get() as Row | undefined;
  d.prepare(`DELETE FROM shopify_connection`).run();
  return r ? String(r.shop) : null;
}

/** The keys are no good: drop them, show "needs reconnecting" in Settings and tell the owners */
export function markReconnect(shop: string, reason: string) {
  const d = getDb();
  transaction(d, () => {
    const r = d.prepare(`SELECT connected_at FROM shopify_connection WHERE id = 1 AND shop = ? AND status = 'connected'`).get(shop) as Row | undefined;
    if (!r) return;
    d.prepare(
      `UPDATE shopify_connection SET status = 'reconnect', access_token = NULL, access_expires_at = NULL,
         refresh_token = NULL, refresh_expires_at = NULL, refreshing_until = NULL, last_error = ?, updated_at = datetime('now')
       WHERE id = 1`,
    ).run(reason.slice(0, 300));
    // Once per connection: reconnecting starts a new one
    createAlert(d, {
      kind: "shopify",
      subject: "[Helpdesk] Reconnect the Shopify store",
      body: `The helpdesk can't sign in to ${shop}.myshopify.com any more: ${reason}\n\nCustomer and order lookups are off until the owner reconnects the store: ${siteUrl()}/settings`,
      dedupeKey: `shopify:reconnect:${shop}:${String(r.connected_at)}`,
    });
    notifyOwners(d, "alert", null, `The Shopify store needs reconnecting: ${reason}`);
  });
}

// --- Tokens

/** One call to Shopify's token endpoint (code exchange or refresh) */
export async function requestTokens(shop: string, params: Record<string, string>): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    throw tokenError(`Shopify sign-in failed: ${err instanceof Error && err.name === "TimeoutError" ? "timed out" : "network error"}`, false);
  }
  const body = (await res.json().catch(() => null)) as Row | null;
  if (!res.ok || typeof body?.access_token !== "string") {
    // Shopify's own error code only (e.g. invalid_request), never the request
    const why = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
    throw tokenError(`Shopify sign-in failed: ${why.slice(0, 120)}`, res.ok || (res.status < 500 && res.status !== 429));
  }
  const now = Date.now();
  const at = (seconds: unknown) => (Number(seconds) > 0 ? now + Number(seconds) * 1000 : null);
  return {
    accessToken: body.access_token,
    accessExpiresAt: at(body.expires_in),
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    refreshExpiresAt: at(body.refresh_token_expires_in),
    scopes: splitScopes(body.scope),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NOT_CONNECTED = "The Shopify store isn't connected.";
const RECONNECT = "The Shopify store needs reconnecting (Settings).";

type Claim =
  | { token: string }
  | { wait: true }
  | { shop: string; refreshToken: string }
  | { fail: string; reconnect?: { shop: string; reason: string } };

// Decided under the write lock, so only one process takes the refresh token
function claim(refused: string | null): Claim {
  const d = getDb();
  return transaction(d, () => {
    const r = d.prepare(`SELECT * FROM shopify_connection WHERE id = 1`).get() as Row | undefined;
    if (!r) return { fail: NOT_CONNECTED };
    if (r.status !== "connected") return { fail: RECONNECT };
    const shop = String(r.shop);
    const unreadable = { fail: RECONNECT, reconnect: { shop, reason: "The saved keys can't be read on this server." } };
    const access = unseal(r.access_token, shop);
    if (!access) return unreadable;
    const now = Date.now();
    const expires = r.access_expires_at == null ? null : Number(r.access_expires_at);
    if ((expires === null || expires - now > EARLY_MS) && access !== refused) return { token: access };
    if (Number(r.refreshing_until ?? 0) > now) return { wait: true };
    if (r.refresh_token == null) {
      return { fail: RECONNECT, reconnect: { shop, reason: "Shopify refused the saved keys." } };
    }
    const refreshToken = unseal(r.refresh_token, shop);
    if (!refreshToken) return unreadable;
    if (r.refresh_expires_at != null && Number(r.refresh_expires_at) <= now) {
      return { fail: RECONNECT, reconnect: { shop, reason: "The connection went unused for 90 days and lapsed." } };
    }
    d.prepare(`UPDATE shopify_connection SET refreshing_until = ? WHERE id = 1`).run(now + LEASE_MS);
    return { shop, refreshToken };
  });
}

/**
 * A working access token for the store connected from Settings. refused: the token Shopify
 * just turned down (HTTP 401), so it isn't handed out again. Throws when no store is
 * connected or Shopify won't issue a token; a refusal marks the connection for reconnecting.
 */
export async function settingsAccessToken(app: ShopifyApp, refused: string | null = null): Promise<string> {
  for (const started = Date.now(); ; ) {
    const c = claim(refused);
    if ("token" in c) return c.token;
    if ("fail" in c) {
      if (c.reconnect) markReconnect(c.reconnect.shop, c.reconnect.reason);
      throw tokenError(c.fail, !!c.reconnect);
    }
    if ("wait" in c) {
      // Another process is refreshing: its new token lands in the row
      if (Date.now() - started > LEASE_MS) throw tokenError("Shopify sign-in failed: timed out", false);
      await sleep(250);
      continue;
    }
    return refresh(app, c.shop, c.refreshToken);
  }
}

async function refresh(app: ShopifyApp, shop: string, refreshToken: string): Promise<string> {
  const d = getDb();
  const params = { client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken };
  let tokens: TokenSet;
  try {
    tokens = await requestTokens(shop, params).catch(async (err: TokenError) => {
      // A timeout or server error: the same refresh token is still good for one more try
      if (err.refused) throw err;
      await sleep(500);
      return requestTokens(shop, params);
    });
  } catch (err) {
    const e = err as TokenError;
    d.prepare(`UPDATE shopify_connection SET refreshing_until = NULL, last_error = ? WHERE id = 1 AND shop = ?`).run(e.message.slice(0, 300), shop);
    if (e.refused) {
      markReconnect(shop, `Shopify refused the saved keys (${e.message.replace(/^Shopify sign-in failed: /, "")}).`);
      throw tokenError(RECONNECT, true);
    }
    throw e;
  }
  // Skipped if the store was disconnected or reconnected meanwhile
  d.prepare(
    `UPDATE shopify_connection SET access_token = ?, access_expires_at = ?, refresh_token = ?, refresh_expires_at = ?,
       scopes = COALESCE(?, scopes), refreshing_until = NULL, last_error = NULL, updated_at = datetime('now')
     WHERE id = 1 AND shop = ? AND refreshing_until IS NOT NULL`,
  ).run(
    seal(tokens.accessToken, shop),
    tokens.accessExpiresAt,
    tokens.refreshToken ? seal(tokens.refreshToken, shop) : null,
    tokens.refreshExpiresAt,
    tokens.scopes.length ? tokens.scopes.join(",") : null,
    shop,
  );
  return tokens.accessToken;
}
