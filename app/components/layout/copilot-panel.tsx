"use client";

import { CopilotChat, useCopilotChatContext } from "@yourgpt/copilot-sdk/ui";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Sparkles, ShoppingBag, X, MapPin, Mail, Phone, Shield, Link2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  customerLocation,
  customerTier,
  formatDuration,
  formatIntent,
  formatMoney,
  formatRelative,
} from "@/lib/helpdesk-format";
import { useDashboard } from "../context/dashboard-context";
import { Avatar, IconButton, StatusBadge, copyText } from "../ui";
import { ticketStatusOf } from "./demo-sidebar";
import { StoreRail } from "./store-rail";
import { ProductRail } from "./product-rail";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-5 py-4 last:border-b-0">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

const TIER_TONE: Record<string, string> = {
  VIP: "bg-chart-5/12 text-chart-5",
  Loyal: "bg-primary/12 text-primary",
  Returning: "bg-info/12 text-info",
  New: "bg-success/12 text-success",
};

function CustomerDetails() {
  const { ticketDetail, customerRisk, sentiment, linkedTickets, selectTicket, selectedTicketId, notify } =
    useDashboard();
  if (!ticketDetail || ticketDetail.ticket.id !== selectedTicketId) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        {selectedTicketId ? "Loading ticket details…" : "Open a ticket to see who you&apos;re talking to."}
      </p>
    );
  }
  const { customer, ticket, stats, history } = ticketDetail;
  const name = customer?.name ?? ticket.customerName ?? ticket.customerEmail ?? "Unknown customer";
  const email = customer?.email ?? ticket.customerEmail;
  const location = customerLocation(customer);
  const tier = customerTier(customer);
  const others = history.filter((t) => t.id !== ticket.id);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-start gap-3 border-b border-border px-5 py-5">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-foreground">{name}</p>
            {customer && !ticket.simulated && (
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", TIER_TONE[tier] ?? "bg-muted text-muted-foreground")}>
                {tier}
              </span>
            )}
          </div>
          <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
            {email && (
              <button
                type="button"
                title="Copy email"
                onClick={async () => {
                  if (await copyText(email)) notify("Email copied", "info");
                  else notify("Couldn't copy: the browser blocked clipboard access", "error");
                }}
                className="group flex max-w-full items-center gap-1.5 hover:text-foreground"
              >
                <Mail className="size-3.5 shrink-0" />
                <span className="truncate">{email}</span>
                <Copy className="size-3 shrink-0 opacity-0 group-hover:opacity-100" />
              </button>
            )}
            {customer?.phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="size-3.5" />
                {customer.phone}
              </div>
            )}
            {location && (
              <div className="flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {location}
              </div>
            )}
          </div>
        </div>
      </div>

      {ticket.simulated && <StoreRail key={ticket.id} ticketId={ticket.id} />}
      {ticket.productHandle && <ProductRail key={`${ticket.id}:${ticket.productHandle}`} handle={ticket.productHandle} />}

      <Section title="Support history">
        <div className="grid grid-cols-2 gap-2">
          {!ticket.simulated && <Stat label="Lifetime spend" value={customer ? formatMoney(customer.totalSpent) : "Unavailable"} />}
          {!ticket.simulated && <Stat label="Orders" value={customer?.totalOrders ?? "Unavailable"} />}
          <Stat label="Tickets" value={stats.ticketCount} />
          <Stat label="Last 90 days" value={stats.ticketsLast90Days} />
          <Stat label="Avg. first reply" value={formatDuration(stats.avgFirstResponseSeconds)} />
          <Stat label="Avg. resolution" value={formatDuration(stats.avgResolutionSeconds)} />
        </div>
        {ticket.simulated && <p className="mt-3 text-sm text-muted-foreground">{ticket.channel === "simulator" ? "Store orders and lifetime spend are unavailable for simulated customers." : "Store orders and lifetime spend appear in the verified store lookup below when available."}</p>}
        {customer?.note && <p className="mt-3 text-xs text-muted-foreground">{customer.note}</p>}
      </Section>

      {(customerRisk || sentiment) && (
        <Section title="AI insights">
          <div className="space-y-2">
            {customerRisk && (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium",
                  customerRisk.level === "low"
                    ? "bg-success/10 text-success"
                    : customerRisk.level === "medium"
                      ? "bg-warning/12 text-warning"
                      : "bg-destructive/10 text-destructive",
                )}
              >
                <Shield className="size-3.5" />
                <span className="capitalize">{customerRisk.level} churn risk</span>
                <span className="ml-auto tabular-nums">{customerRisk.score}/100</span>
              </div>
            )}
            {sentiment && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs font-medium text-foreground">
                <span>{sentiment.emoji}</span>
                <span>{sentiment.label}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{sentiment.score}/100</span>
              </div>
            )}
          </div>
        </Section>
      )}

      {stats.topIntents.length > 0 && (
        <Section title="Usually writes about">
          <div className="flex flex-wrap gap-1.5">
            {stats.topIntents.slice(0, 6).map((i) => (
              <span key={i.intent} className="rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
                {formatIntent(i.intent)} <span className="text-muted-foreground">×{i.count}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title={`Other tickets${others.length ? ` (${others.length})` : ""}`}>
        {others.length === 0 ? (
          <p className="text-xs text-muted-foreground">This is their first ticket.</p>
        ) : (
          <ul className="-mx-2 space-y-0.5">
            {others.slice(0, 8).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => selectTicket(t.id)}
                  aria-current={t.id === selectedTicketId ? "true" : undefined}
                  className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">{t.subject ?? "(no subject)"}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                      {formatRelative(t.createdAt)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusBadge status={ticketStatusOf(t)} />
                    <span className="font-mono text-[10px] text-muted-foreground">{t.id}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {linkedTickets.length > 0 && (
        <Section title="Linked by AI">
          <ul className="space-y-1">
            {linkedTickets.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <Link2 className="size-3.5 text-muted-foreground" />
                <span className="font-mono">#{t.id}</span>
                <span className="truncate text-muted-foreground">{t.title}</span>
                <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">{t.status}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// Tool cards (including loading skeletons and approval steps) are rendered by
// each tool's `render` in ticketing-tools.tsx.
const panelMedia = "(max-width: 1439px)";
const subscribePanelMedia = (callback: () => void) => {
  const media = window.matchMedia(panelMedia);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};
const compactPanel = () => window.matchMedia(panelMedia).matches;

export function CopilotPanel() {
  const { sidePanel, setSidePanel, selectedTicketId, ticketDetail } = useDashboard();
  const activeTicket = ticketDetail?.ticket.id === selectedTicketId ? ticketDetail.ticket : null;
  const narrow = useSyncExternalStore(subscribePanelMedia, compactPanel, () => false);
  const modal = narrow && !!sidePanel;
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter((element) => element.getClientRects().length);
    const first = () => focusable()[0];
    first()?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSidePanel(null);
      } else if (event.key === "Tab") {
        const elements = focusable();
        const target = event.shiftKey ? elements.at(-1) : elements[0];
        const boundary = event.shiftKey ? elements[0] : elements.at(-1);
        if (document.activeElement === boundary || !panelRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          target?.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) first()?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, [modal, setSidePanel]);

  return (
    <>
    {modal && <div aria-hidden="true" className="fixed inset-0 z-[70] bg-background/60 backdrop-blur-sm" onMouseDown={() => setSidePanel(null)} />}
    <aside
      ref={panelRef}
      id="ticket-side-panel"
      role={modal ? "dialog" : undefined}
      aria-modal={modal || undefined}
      aria-label="Ticket side panel"
      className={cn(
        "flex w-[22rem] max-w-full shrink-0 flex-col border-l border-border bg-sidebar 2xl:w-[24rem]",
        "max-[1439px]:fixed max-[1439px]:inset-y-0 max-[1439px]:right-0 max-[1439px]:z-[80] max-[1439px]:w-[min(24rem,100vw)] max-[1439px]:shadow-pop",
        !sidePanel && "hidden",
      )}
    >
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <div role="tablist" className="flex flex-1 gap-1">
          {(
            [
              ["copilot", "AI copilot", Sparkles],
              ["customer", "Details", ShoppingBag],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={sidePanel === value}
              onClick={() => setSidePanel(value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                sidePanel === value
                  ? "bg-background text-foreground shadow-soft ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className={cn("size-4", value === "copilot" && sidePanel === value && "text-primary")} />
              {label}
            </button>
          ))}
        </div>
        <IconButton label="Hide panel" onClick={() => setSidePanel(null)}>
          <X className="size-4" />
        </IconButton>
      </div>

      {/* Kept mounted so a running copilot answer isn't interrupted */}
      <div className={cn("min-h-0 flex-1 flex-col", sidePanel === "copilot" ? "flex" : "hidden")}>
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground" role="status">
          {activeTicket ? `Current ticket: ${activeTicket.id} · ${activeTicket.subject ?? "No subject"}` : "Open a ticket to ask about its conversation."}
          {activeTicket?.simulated && " Use the AI draft below the conversation for suggested replies. Copilot helps investigate questions."}
        </p>
        <CopilotChat
          placeholder="Ask about this ticket, customer, products…"
          className="h-full"
          persistence={true}
          showThreadPicker={false}
          renderInput={() => <CopilotInput key={activeTicket?.id ?? "none"} disabled={!activeTicket} />}
          showPoweredBy={false}
          header={{ name: "Support copilot" }}
          welcome={false}
          suggestions={[
            "Summarize this ticket",
            "Who is this customer and how valuable are they?",
            "Find similar tickets",
            "Which policies apply to this ticket?",
          ]}
        >
          <CopilotChat.Home className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <h2 className="font-semibold">Investigate this ticket</h2>
              <p className="mt-2 text-sm text-muted-foreground">Ask about the conversation, current policies, or verified customer details. Use the AI draft in the conversation to prepare a reply.</p>
            </div>
            <CopilotInput key={activeTicket?.id ?? "none"} disabled={!activeTicket} />
          </CopilotChat.Home>
          <CopilotChat.ChatView />
        </CopilotChat>
      </div>
      {sidePanel === "customer" && <CustomerDetails />}
    </aside>
    </>
  );
}

function CopilotInput({ disabled }: { disabled: boolean }) {
  const { send: sendMessage, isLoading, onStop } = useCopilotChatContext();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || isLoading || !text.trim()) return;
    const prompt = text.trim();
    setError(null);
    setText("");
    try { await sendMessage(prompt); }
    catch { setText(prompt); setError("Couldn't ask the copilot. Try again."); }
  };
  return (
    <form onSubmit={submit} className="space-y-2 border-t border-border p-3">
      <label htmlFor="copilot-question" className="block text-xs font-medium">Ask the copilot about this ticket</label>
      <textarea id="copilot-question" value={text} onChange={(e) => setText(e.target.value)} disabled={disabled || isLoading} rows={2}
        placeholder={disabled ? "Open a ticket first" : "Ask about this ticket, customer, products…"}
        className="w-full resize-y rounded-lg border border-input bg-background p-2 text-sm outline-none focus:border-ring disabled:opacity-60" />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <button type="submit" disabled={disabled || isLoading || !text.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">{isLoading ? "Copilot is thinking…" : "Ask copilot"}</button>
      {isLoading && onStop && <button type="button" onClick={onStop} className="ml-2 rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-accent">Stop copilot</button>}
    </form>
  );
}
