"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Package, Truck, RotateCcw, RefreshCw, AlertTriangle, ArrowRightLeft, ChevronDown, ImageOff, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/helpdesk-format";
import type { RailOrder, RailResponse } from "@/lib/store";
import { apiJson } from "../api";

const money = (value: number | null | undefined, currency?: string | null) => {
  if (value == null) return "Unavailable";
  // Never invent a currency for an amount Shopify hasn't identified.
  if (!currency) return `${value.toLocaleString()} (currency unavailable)`;
  try { return value.toLocaleString(undefined, { style: "currency", currency }); }
  catch { return `${value.toLocaleString()} ${currency}`; }
};
const date = (value: string | null) => value ? formatDate(value) : "Unavailable";
const RETURN_LABEL: Record<string, string> = {
  requested: "Requested", label_sent: "Label sent", in_transit: "On its way back",
  received: "Received", refunded: "Refunded", exchanged: "Exchanged", rejected: "Rejected",
};

function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0 border-b border-border px-5 py-4 last:border-b-0">
      <h3 id={id} className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ProductImage({ item }: { item: RailOrder["items"][number] }) {
  const [failed, setFailed] = useState(false);
  const url = item.image?.url;
  const hasImage = url && /^https:\/\//i.test(url) && !failed;
  return (
    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
      {hasImage ? (
        <Image unoptimized src={url} alt={item.image?.alt || item.title} width={64} height={64}
          className="size-full object-contain" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span role="img" aria-label="Product image unavailable" title="Product image unavailable"><ImageOff className="size-5 text-muted-foreground" /></span>
      )}
    </div>
  );
}

function OrderCard({ order, matched, initialOpen, ticketId }: { order: RailOrder; matched?: boolean; initialOpen?: boolean; ticketId: string }) {
  const [open, setOpen] = useState(!!matched || !!initialOpen);
  const [loaded, setLoaded] = useState<RailOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const current = loaded ?? order;
  return (
    <article className={cn("min-w-0 rounded-xl border text-xs", matched ? "border-primary/25 bg-primary/5" : "border-border bg-muted/30")}>
      <h4>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
          className="flex w-full min-w-0 flex-wrap items-center gap-2 rounded-xl p-3 text-left hover:bg-accent/50">
          <Package className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 break-words font-semibold">{current.name}</span>
          <span className="font-semibold tabular-nums">{money(current.total, current.currency)}</span>
          <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
          <span className="w-full text-muted-foreground">{date(current.placedAt)}{matched && " · Matched to this ticket"}</span>
          <span className="rounded bg-background px-1.5 py-1 capitalize">{current.payment ?? "Payment unavailable"}</span>
          <span className="rounded bg-background px-1.5 py-1 capitalize">{current.cancelledAt ? "Cancelled" : current.fulfillment ?? "Fulfillment unavailable"}</span>
        </button>
      </h4>
      <div id={id} hidden={!open} className="space-y-4 border-t border-border p-3">
        {current.cancelledAt && <p className="text-destructive">Cancelled {date(current.cancelledAt)}</p>}
        <div>
          <h5 className="mb-2 font-semibold">Products</h5>
          <ul className="space-y-3">
            {current.items.map((item, index) => (
              <li key={`${item.sku}-${index}`} className="flex min-w-0 gap-3">
                <ProductImage key={item.image?.url ?? "unavailable"} item={item} />
                <div className="min-w-0 flex-1 space-y-1 break-words [overflow-wrap:anywhere]">
                  <p className="font-medium leading-relaxed">{item.title || "Product title unavailable"}</p>
                  {item.variant && item.variant !== "Default Title" && <p className="text-muted-foreground">{item.variant}</p>}
                  {item.sku && <p className="text-muted-foreground">SKU: {item.sku}</p>}
                  <p>Quantity: {item.quantity}</p>
                  <p className="tabular-nums">{money(item.price, current.currency)} each <span className="text-muted-foreground">before discounts</span></p>
                  <p className="tabular-nums">Item total: {money(item.lineTotal, current.currency)}</p>
                </div>
              </li>
            ))}
            {!current.items.length && <li className="text-muted-foreground">No products returned by Shopify.</li>}
          </ul>
          {current.items.length > 0 && <p className="mt-3 text-[11px] text-muted-foreground">Item totals include line and code discounts. Order-level discounts are reflected in the order total below.</p>}
          {current.itemsTruncated && (
            <div className="mt-3 space-y-2">
              <p className="text-muted-foreground">More products are available. Showing {current.items.length} so far.</p>
              {!loaded && <button type="button" disabled={busy} onClick={async () => {
                setBusy(true); setError(null);
                try {
                  const result = await apiJson<{ order: RailOrder }>(`/api/helpdesk/orders?ticket=${encodeURIComponent(ticketId)}&name=${encodeURIComponent(current.name)}`);
                  setLoaded(result.order);
                } catch (err) { setError(err instanceof Error ? err.message : "Couldn't load the remaining products"); }
                finally { setBusy(false); }
              }} className="inline-flex items-center gap-1.5 rounded-lg bg-background px-3 py-2 font-medium ring-1 ring-border disabled:opacity-50">
                {busy && <Loader2 className="size-3.5 animate-spin" />} Load remaining products
              </button>}
              {loaded && <p className="text-warning">This large order exceeds the product loading limit. Additional products are unavailable here.</p>}
              {error && <p role="alert" className="text-destructive">{error}</p>}
            </div>
          )}
        </div>
        <dl className="space-y-1.5 border-t border-border pt-3">
          {([
            ["Subtotal after discounts", current.subtotal], ["Discounts", current.discounts],
            ["Shipping", current.shipping], ["Tax", current.tax], ["Order total", current.total],
            ["Refunded", current.refunded],
          ] as const).map(([label, value]) => (
            <div key={label} className={cn("flex justify-between gap-3", label === "Order total" && "font-semibold")}>
              <dt>{label}</dt><dd className="shrink-0 tabular-nums">{money(value, current.currency)}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-2 border-t border-border pt-3">
          <h5 className="flex items-center gap-1.5 font-semibold"><Truck className="size-4" /> Shipping & tracking</h5>
          {current.shipments.length ? current.shipments.map((shipment, index) => (
            <div key={index} className="space-y-1 break-words [overflow-wrap:anywhere]">
              <p className="capitalize">{shipment.carrier || "Carrier unavailable"} · {shipment.shipmentStatus ?? shipment.status ?? "Status unavailable"}</p>
              <p className="text-muted-foreground">Tracking: {shipment.tracking || "Unavailable"}</p>
            </div>
          )) : <p className="text-muted-foreground">No shipment information returned by Shopify.</p>}
        </div>
        {current.refunds.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <h5 className="font-semibold">Refund history</h5>
            {current.refunds.map((refund, index) => (
              <p key={index} className="break-words">{date(refund.at)} · {money(refund.amount, current.currency)}{refund.note && ` · ${refund.note}`}</p>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export function StoreRail({ ticketId }: { ticketId: string }) {
  const [rail, setRail] = useState<RailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orderName, setOrderName] = useState("");
  const [found, setFound] = useState<RailOrder | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const request = useRef(0);
  const mounted = useRef(false);
  const load = useCallback((refresh = false) => {
    const mine = ++request.current;
    return apiJson<RailResponse>(`/api/helpdesk/tickets/${encodeURIComponent(ticketId)}/store${refresh ? "?refresh=1" : ""}`)
      .then((result) => {
        if (!mounted.current || mine !== request.current) return;
        setRail(result); setError(null); setFound(null); setLookupError(null);
      })
      .catch((err) => {
        if (mounted.current && mine === request.current) setError(err instanceof Error ? err.message : "Couldn't load store data");
      })
      .finally(() => {
        if (mounted.current && mine === request.current) setBusy(false);
      });
  }, [ticketId]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  const snap = rail?.snapshot;
  const others = snap?.orders.filter((order) => order.name !== snap.matchedOrder?.name) ?? [];
  return (
    <>
      <Rail title="Shopify customer">
        <div className="mb-3 flex items-start gap-2">
          <p className="flex-1 text-xs text-muted-foreground">Customer and orders for this ticket&apos;s verified sender.</p>
          <button type="button" aria-label="Refresh store data" title="Refresh store data" disabled={busy}
            onClick={() => { setBusy(true); void load(true); }} className="rounded-lg p-1.5 hover:bg-accent disabled:opacity-40">
            <RefreshCw className={cn("size-4", busy && "animate-spin")} />
          </button>
        </div>
        {error && <div role="alert" className="mb-3 space-y-2 text-xs text-destructive">
          <p>{error}</p><button type="button" disabled={busy} onClick={() => { setBusy(true); void load(true); }} className="rounded-lg px-2 py-1 font-medium ring-1 ring-border">Try again</button>
        </div>}
        {!rail && !error && <p role="status" className="text-sm text-muted-foreground">Reading Shopify customer and orders…</p>}
        {rail && !rail.available && <p className="text-sm text-muted-foreground">{rail.reason}</p>}
        {rail?.available && snap && (
          <div className="space-y-3 text-xs">
            <p className={cn("flex items-start gap-1.5", rail.stale ? "text-warning" : "text-muted-foreground")}>
              {rail.stale && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
              <span>{rail.stale ? "Refresh delayed: showing the last successful read" : "Last updated"}{rail.fetchedAt && ` · ${formatDateTime(rail.fetchedAt)}`}</span>
            </p>
            {snap.customer && <>
              <dl className="space-y-2 break-words [overflow-wrap:anywhere]">
                {([ ["Name", snap.customer.name], ["Email", snap.customer.email], ["Phone", snap.customer.phone], ["Location", snap.customer.location], ["Customer since", date(snap.customer.since)] ] as const).map(([label, value]) => (
                  <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value || "Unavailable"}</dd></div>
                ))}
              </dl>
              <dl className="grid grid-cols-2 gap-2">
                <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2"><dt className="text-muted-foreground">Orders</dt><dd className="mt-1 font-semibold">{snap.customer.ordersCount ?? "Unavailable"}</dd></div>
                <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2"><dt className="text-muted-foreground">Lifetime spend</dt><dd className="mt-1 break-words font-semibold">{money(snap.customer.totalSpent, snap.customer.currency)}</dd></div>
              </dl>
            </>}
            <p className="text-muted-foreground">Store credit and gift-card balances are unavailable.</p>
          </div>
        )}
      </Rail>
      {rail?.available && snap && (
        <Rail title="Orders">
          <div className="space-y-3">
            {snap.matchedOrder ? <OrderCard key={`matched-${snap.matchedOrder.name}-${rail.fetchedAt}`} order={snap.matchedOrder} matched ticketId={ticketId} /> : <p className="text-xs text-muted-foreground">No order matched to this ticket.</p>}
            {others.map((order) => <OrderCard key={`${order.name}-${rail.fetchedAt}`} order={order} ticketId={ticketId} />)}
            {!snap.orders.length && !snap.matchedOrder && <p className="text-xs text-muted-foreground">No orders returned by Shopify.</p>}
            <p className="text-xs text-muted-foreground">Showing up to 10 recent orders plus the order matched to this ticket. Older orders depend on the store connection&apos;s permissions.</p>
            <form onSubmit={async (event) => {
              event.preventDefault();
              if (!orderName.trim() || looking || rail.stale || busy || error) return;
              const version = request.current;
              setLooking(true); setFound(null); setLookupError(null);
              try {
                const result = await apiJson<{ order: RailOrder }>(`/api/helpdesk/orders?ticket=${encodeURIComponent(ticketId)}&name=${encodeURIComponent(orderName.trim())}`);
                if (mounted.current && version === request.current) setFound(result.order);
              } catch (err) {
                if (mounted.current && version === request.current) setLookupError(err instanceof Error ? err.message : "Couldn't find this customer's order");
              } finally {
                if (mounted.current) setLooking(false);
              }
            }} className="space-y-2 border-t border-border pt-3">
              <label htmlFor={`order-number-${ticketId}`} className="block text-xs font-medium">Order number</label>
              <div className="flex flex-wrap gap-2">
                <input id={`order-number-${ticketId}`} value={orderName} onChange={(event) => { setOrderName(event.target.value); setLookupError(null); setFound(null); }}
                  maxLength={40} placeholder="e.g. #1001" disabled={looking || busy || !!rail.stale || !!error}
                  className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring disabled:opacity-50" />
                <button type="submit" disabled={!orderName.trim() || looking || busy || !!rail.stale || !!error}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">
                  {looking ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />} Find order
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Look up another order belonging to this customer.</p>
              {(rail.stale || error) && <p className="text-xs text-warning">Refresh store data before looking up another order.</p>}
              {lookupError && <p role="alert" className="text-xs text-destructive">{lookupError}</p>}
              {found && <OrderCard key={`found-${found.name}`} order={found} initialOpen ticketId={ticketId} />}
            </form>
          </div>
        </Rail>
      )}
      {!!rail?.returns.length && <Rail title={`Returns & exchanges (${rail.returns.length})`}>
        <ul className="space-y-2">
          {rail.returns.map((item) => <li key={item.id} className="space-y-1 rounded-lg bg-muted/60 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {item.kind === "exchange" ? <ArrowRightLeft className="size-3.5" /> : <RotateCcw className="size-3.5" />}
              <span className="font-medium capitalize">{item.kind}</span><span>{item.orderName}</span>
              <span className="ml-auto rounded bg-background px-1.5 py-1 font-medium">{RETURN_LABEL[item.status] ?? item.status}</span>
            </div>
            {!!item.items.length && <p className="break-words text-muted-foreground">{item.items.join(", ")}</p>}
            {item.refundAmount != null && <p>Refund amount: {item.refundAmount.toLocaleString()} (currency unavailable)</p>}
            {item.exchangeFor && <p className="break-words">For: {item.exchangeFor}</p>}
          </li>)}
        </ul>
      </Rail>}
    </>
  );
}
