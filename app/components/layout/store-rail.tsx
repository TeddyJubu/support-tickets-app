"use client";

// Store facts for the open ticket's customer: the matched order, returns and exchanges, and
// order history, read from the Shopify store. Missing amounts say "unavailable", never $0.

import { useCallback, useEffect, useState } from "react";
import { Package, Truck, RotateCcw, RefreshCw, AlertTriangle, ArrowRightLeft, CreditCard, Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/helpdesk-format";
import type { RailOrder, RailResponse } from "@/lib/store";
import { apiJson } from "../api";

const money = (v: number | null, currency?: string | null) =>
  v == null ? "unavailable" : v.toLocaleString(undefined, { style: "currency", currency: currency || "USD" });
const date = (v: string | null) => (v ? formatDate(v) : "unavailable");
const RETURN_LABEL: Record<string, string> = {
  requested: "Requested",
  label_sent: "Label sent",
  in_transit: "On its way back",
  received: "Received",
  refunded: "Refunded",
  exchanged: "Exchanged",
  rejected: "Rejected",
};

function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-5 py-4 last:border-b-0">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function OrderCard({ order, matched }: { order: RailOrder; matched?: boolean }) {
  return (
    <div className={cn("rounded-lg p-3 text-xs", matched ? "bg-primary/5 ring-1 ring-primary/20" : "bg-muted/60")}>
      <div className="flex items-center gap-2">
        <Package className="size-3.5 text-muted-foreground" />
        <span className="font-semibold text-foreground">{order.name}</span>
        <span className="text-muted-foreground">{date(order.placedAt)}</span>
        <span className="ml-auto font-medium tabular-nums">{money(order.total, order.currency)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <span className="rounded bg-background px-1.5 py-0.5">{order.payment ?? "payment unknown"}</span>
        <span className="rounded bg-background px-1.5 py-0.5">{order.cancelledAt ? "cancelled" : (order.fulfillment ?? "unfulfilled")}</span>
      </div>
      {matched && (
        <>
          <ul className="mt-2 space-y-1">
            {order.items.map((i, k) => (
              <li key={k} className="flex gap-2">
                <span className="text-muted-foreground">{i.quantity}×</span>
                <span className="min-w-0 flex-1 truncate" title={i.title}>
                  {i.title}
                </span>
                <span className="tabular-nums">{money(i.price, order.currency)}</span>
              </li>
            ))}
            {!order.items.length && <li className="text-muted-foreground">No line items on record</li>}
          </ul>
          <div className="mt-2 space-y-1">
            {order.shipments.length ? (
              order.shipments.map((sh, k) => (
                <p key={k} className="flex items-center gap-1.5">
                  <Truck className="size-3.5 text-muted-foreground" />
                  {[sh.carrier, sh.tracking].filter(Boolean).join(" ") || "Shipment"} · {sh.shipmentStatus ?? sh.status ?? "status unknown"}
                </p>
              ))
            ) : (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Truck className="size-3.5" /> Not shipped yet
              </p>
            )}
            {order.refunds.length > 0 && (
              <p className="flex items-center gap-1.5">
                <RotateCcw className="size-3.5 text-muted-foreground" />
                Refunded {money(order.refunded, order.currency)}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function StoreRail({ ticketId }: { ticketId: string }) {
  const [rail, setRail] = useState<RailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    (refresh = false) =>
      apiJson<RailResponse>(`/api/helpdesk/tickets/${ticketId}/store${refresh ? "?refresh=1" : ""}`)
        .then((r) => {
          setRail(r);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load store data")),
    [ticketId],
  );
  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Rail title="Store">
        <p className="text-xs text-destructive">{error}</p>
      </Rail>
    );
  }
  if (!rail) {
    return (
      <Rail title="Store">
        <p className="text-xs text-muted-foreground">Reading the store…</p>
      </Rail>
    );
  }
  const snap = rail.snapshot;
  const others = snap?.orders.filter((o) => o.name !== snap.matchedOrder?.name) ?? [];
  return (
    <>
      <Rail title="Store">
        {!rail.available ? (
          <p className="text-xs text-muted-foreground">{rail.reason}</p>
        ) : (
          <div className="space-y-3">
            <div className={cn("flex items-center gap-2 text-[11px]", rail.stale ? "text-warning" : "text-muted-foreground")}>
              {rail.stale && <AlertTriangle className="size-3.5" />}
              <span>
                {rail.stale
                  ? `Refresh delayed: showing the last successful read (${rail.fetchedAt ? formatDateTime(rail.fetchedAt) : "earlier"})`
                  : `Read from the store ${rail.fetchedAt ? formatDateTime(rail.fetchedAt) : ""}`}
              </span>
              <button
                type="button"
                aria-label="Refresh store data"
                title="Refresh"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await load(true);
                  setBusy(false);
                }}
                className="ml-auto rounded p-1 hover:bg-accent disabled:opacity-40"
              >
                <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              </button>
            </div>
            {snap?.customer && (
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-muted/60 px-3 py-2">
                  <dt className="text-muted-foreground">Orders</dt>
                  <dd className="mt-0.5 font-medium">{snap.customer.ordersCount ?? "Unavailable"}</dd>
                </div>
                <div className="rounded-lg bg-muted/60 px-3 py-2">
                  <dt className="text-muted-foreground">Lifetime spend</dt>
                  <dd className="mt-0.5 font-medium">{money(snap.customer.totalSpent, snap.matchedOrder?.currency ?? snap.orders[0]?.currency)}</dd>
                </div>
              </dl>
            )}
            {snap?.matchedOrder ? (
              <OrderCard order={snap.matchedOrder} matched />
            ) : (
              <p className="text-xs text-muted-foreground">No order matched to this ticket.</p>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-muted/60 px-3 py-2">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CreditCard className="size-3" /> Store credit
                </div>
                <div className="mt-0.5 font-medium text-muted-foreground">unavailable</div>
              </div>
              <div className="rounded-lg bg-muted/60 px-3 py-2">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Gift className="size-3" /> Gift cards
                </div>
                <div className="mt-0.5 font-medium text-muted-foreground">unavailable</div>
              </div>
            </div>
          </div>
        )}
      </Rail>

      {rail.returns.length > 0 && (
        <Rail title={`Returns & exchanges (${rail.returns.length})`}>
          <ul className="space-y-2">
            {rail.returns.map((r) => (
              <li key={r.id} className="rounded-lg bg-muted/60 p-3 text-xs">
                <div className="flex items-center gap-2">
                  {r.kind === "exchange" ? <ArrowRightLeft className="size-3.5 text-muted-foreground" /> : <RotateCcw className="size-3.5 text-muted-foreground" />}
                  <span className="font-medium capitalize">{r.kind}</span>
                  <span className="text-muted-foreground">{r.orderName}</span>
                  <span className="ml-auto rounded bg-background px-1.5 py-0.5 font-medium">{RETURN_LABEL[r.status] ?? r.status}</span>
                </div>
                {r.items.length > 0 && <p className="mt-1 truncate text-muted-foreground">{r.items.join(", ")}</p>}
                {r.refundAmount != null && <p className="mt-1">Refund {money(r.refundAmount)}</p>}
                {r.exchangeFor && <p className="mt-1">For: {r.exchangeFor}</p>}
              </li>
            ))}
          </ul>
        </Rail>
      )}

      {others.length > 0 && (
        <Rail title={`Order history (${others.length})`}>
          <div className="space-y-2">
            {others.map((o) => (
              <OrderCard key={o.name} order={o} />
            ))}
          </div>
        </Rail>
      )}
    </>
  );
}
