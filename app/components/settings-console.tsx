"use client";

// Settings page: which Shopify store the helpdesk reads customers and orders from. Owners
// connect a store (Shopify's approval page, then back here) or disconnect it; agents see
// which store is connected. Never shows the store's keys.

import { useCallback, useEffect, useState } from "react";
import { Store, Link2, Unlink, AlertTriangle, CheckCircle2, Lock, Copy, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShopifyStatus } from "@/lib/shopify-connect";
import { apiJson, jsonInit } from "./api";

const domain = (shop: string) => `${shop}.myshopify.com`;

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5">
        <code className="min-w-0 flex-1 truncate text-xs">{value}</code>
        <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

function AppSetup({ setup, open }: { setup: ShopifyStatus["setup"]; open: boolean }) {
  return (
    <details open={open} className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">Shopify app setup</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          In Shopify&apos;s Dev Dashboard, create an app for this helpdesk and give it these settings. Then put its Client ID and secret in .env.local as
          SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET and restart the helpdesk.
        </p>
        <CopyField label="App URL" value={setup.appUrl} />
        <CopyField label="Allowed redirection URL" value={setup.redirectUrl} />
        <CopyField label="Webhooks URL (app uninstalled and the three privacy topics)" value={setup.webhookUrl} />
        <CopyField label="Scopes" value={setup.scopes.join(",")} />
        <p className="text-xs text-muted-foreground">
          The app also needs protected customer data access (names and email addresses) in the Dev Dashboard, or Shopify hides the customer&apos;s details.
        </p>
      </div>
    </details>
  );
}

export function SettingsConsole() {
  const [status, setStatus] = useState<ShopifyStatus | null>(null);
  const [shopInput, setShopInput] = useState("");
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(
    () =>
      apiJson<ShopifyStatus>("/api/shopify/status")
        .then((s) => {
          setStatus(s);
          if (s.connection) setShopInput((v) => v || domain(s.connection!.shop));
          return true;
        })
        .catch((e) => {
          setNotice({ tone: "error", text: e.message });
          return false;
        }),
    [],
  );

  useEffect(() => {
    // Back from Shopify (?shopify=connected|error), or installed from Shopify's admin (?shop=)
    const params = new URLSearchParams(window.location.search);
    const result = params.get("shopify");
    const shop = params.get("shop");
    if (result || shop) window.history.replaceState(null, "", "/settings");
    load().then((ok) => {
      if (shop) setShopInput(shop);
      if (ok && result === "connected") setNotice({ tone: "ok", text: "The store is connected." });
      if (ok && result === "error") setNotice({ tone: "error", text: params.get("reason") || "Connecting the store didn't work." });
    });
  }, [load]);

  const connect = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy("connect");
    setNotice(null);
    try {
      const { url } = await apiJson<{ url: string }>("/api/shopify/connect", jsonInit("POST", { shop: shopInput }));
      window.location.assign(url);
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "That didn't work" });
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setNotice(null);
    try {
      const r = await apiJson<{ shop: string | null; uninstalled: boolean }>("/api/shopify/disconnect", jsonInit("POST"));
      setNotice({
        tone: "ok",
        text: r.uninstalled
          ? "Disconnected, and the app was removed from the store."
          : `Disconnected. The app may still be listed in ${r.shop ? domain(r.shop) : "the store"}'s admin (Settings → Apps); remove it there if so.`,
      });
      setConfirming(false);
      setShopInput("");
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "That didn't work" });
    } finally {
      setBusy(null);
    }
  };

  const c = status?.connection ?? null;
  const owner = !!status?.canManage;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div className="rounded-xl border border-border bg-card px-4 py-4 text-sm">
        <div className="flex items-start gap-3">
          <Store className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">Shopify store</p>
            <p className="text-xs text-muted-foreground">
              The helpdesk reads a verified email customer&apos;s own record and orders from this store, to show beside their ticket. It never changes anything
              in the store.
            </p>
          </div>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          {!status && !notice && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          )}

          {status?.pinnedShop && (
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <p className="font-medium">{domain(status.pinnedShop)}</p>
                <p className="text-xs text-muted-foreground">
                  {status.active ? "Set in .env.local (SHOPIFY_SHOP)" : "Set in .env.local (SHOPIFY_SHOP), but its keys are missing, so lookups are off"}.
                  {owner && " Remove SHOPIFY_SHOP and restart to connect a store here instead."}
                </p>
              </div>
            </div>
          )}

          {status && !status.pinnedShop && c && (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                {c.status === "connected" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                )}
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    {c.shopName ? `${c.shopName} · ` : ""}
                    {domain(c.shop)}
                  </p>
                  {c.status === "connected" ? (
                    <p className="text-xs text-muted-foreground">
                      Connected{c.connectedBy ? ` by ${c.connectedBy}` : ""}
                      {c.connectedAt ? ` on ${new Date(c.connectedAt).toLocaleDateString()}` : ""}. Reads {c.scopes.join(", ") || "nothing"}.
                    </p>
                  ) : (
                    <p className="text-xs text-warning">
                      Needs reconnecting: {c.lastError ?? "Shopify refused the saved keys"}. Store lookups are off until then.
                    </p>
                  )}
                </div>
              </div>

              {owner && !confirming && (
                <div className="flex flex-wrap gap-2">
                  {c.status !== "connected" && (
                    <button type="button" onClick={() => connect()} disabled={!!busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                      {busy === "connect" ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />} Reconnect
                    </button>
                  )}
                  <button type="button" onClick={() => setConfirming(true)} disabled={!!busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium ring-1 ring-border hover:bg-accent disabled:opacity-50">
                    <Unlink className="size-3.5" /> Disconnect
                  </button>
                </div>
              )}

              {owner && confirming && (
                <div className="space-y-2 rounded-lg bg-destructive/8 p-3 ring-1 ring-destructive/25">
                  <p className="text-xs">
                    Disconnect {domain(c.shop)}? The app is removed from the store and its keys are deleted here, so customer and order details stop showing on
                    tickets. Tickets and replies stay. You can connect this or another store afterwards.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={disconnect} disabled={!!busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-destructive px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                      {busy === "disconnect" ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" />} Disconnect
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} disabled={!!busy} className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium ring-1 ring-border hover:bg-accent">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {status && !status.pinnedShop && !c && (
            <div className="space-y-3">
              <p className="text-muted-foreground">No store is connected, so tickets show no customer or order details.</p>
              {owner && status.appConfigured && (
                <form onSubmit={connect} className="flex flex-wrap items-end gap-2">
                  <label className="min-w-0 flex-1 space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Store address</span>
                    <input
                      value={shopInput}
                      onChange={(e) => setShopInput(e.target.value)}
                      placeholder="your-store.myshopify.com"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-9 w-full rounded-lg bg-background px-3 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </label>
                  <button type="submit" disabled={!!busy || !shopInput.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                    {busy === "connect" ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Connect
                  </button>
                </form>
              )}
              {owner && status.appConfigured && (
                <p className="text-xs text-muted-foreground">Shopify asks the store&apos;s owner to approve read-only access, then brings you back here.</p>
              )}
              {owner && !status.appConfigured && (
                <p className="text-xs text-warning">Set up the Shopify app below before connecting a store.</p>
              )}
            </div>
          )}

          {status && !owner && <p className="mt-3 text-xs text-muted-foreground">Only an owner can connect or disconnect the store.</p>}
        </div>
      </div>

      {notice && (
        <p role="status" className={cn("rounded-lg px-3 py-2 text-sm", notice.tone === "ok" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
          {notice.text}
        </p>
      )}

      {status && owner && !status.pinnedShop && <AppSetup setup={status.setup} open={!status.appConfigured} />}
    </div>
  );
}
