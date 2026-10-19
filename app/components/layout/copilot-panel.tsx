"use client";

import { CopilotChat } from "@yourgpt/copilot-sdk/ui";
import { Sparkles, UserRound, X, MapPin, Mail, Phone, Shield, Link2, Copy } from "lucide-react";
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
import { Avatar, IconButton, StatusBadge } from "../ui";
import { ticketStatusOf } from "./demo-sidebar";

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
  if (!ticketDetail) {
    return <p className="p-5 text-sm text-muted-foreground">Open a ticket to see who you&apos;re talking to.</p>;
  }
  const { customer, ticket, stats, history } = ticketDetail;
  const name = customer?.name ?? ticket.customerName ?? ticket.customerEmail ?? "Unknown customer";
  const email = customer?.email ?? ticket.customerEmail;
  const location = customerLocation(customer);
  const tier = customerTier(customer);
  const others = history.filter((t) => t.id !== ticket.id);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-start gap-3 border-b border-border px-5 py-5">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-foreground">{name}</p>
            {customer && (
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
                onClick={() => {
                  navigator.clipboard?.writeText(email);
                  notify("Email copied", "info");
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

      <Section title="At a glance">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Lifetime spend" value={customer ? formatMoney(customer.totalSpent) : "—"} />
          <Stat label="Orders" value={customer?.totalOrders ?? "—"} />
          <Stat label="Tickets" value={stats.ticketCount} />
          <Stat label="Last 90 days" value={stats.ticketsLast90Days} />
          <Stat label="Avg. first reply" value={formatDuration(stats.avgFirstResponseSeconds)} />
          <Stat label="Avg. resolution" value={formatDuration(stats.avgResolutionSeconds)} />
        </div>
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
export function CopilotPanel() {
  const { sidePanel, setSidePanel } = useDashboard();

  return (
    <aside
      aria-label="Ticket side panel"
      className={cn(
        "flex w-[400px] shrink-0 flex-col border-l border-border bg-sidebar xl:w-[420px]",
        "max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-30 max-xl:shadow-pop",
        !sidePanel && "hidden",
      )}
    >
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <div role="tablist" className="flex flex-1 gap-1">
          {(
            [
              ["copilot", "AI copilot", Sparkles],
              ["customer", "Customer", UserRound],
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
        <CopilotChat
          placeholder="Ask about this ticket, customer, products…"
          className="h-full"
          persistence={true}
          showThreadPicker={true}
          showPoweredBy={false}
          header={{ name: "Support copilot" }}
          welcome={{
            title: "How can I help with this ticket?",
            subtitle: "I can read the ticket, look up the customer and their orders, and draft a reply.",
            suggestionsLabel: "Try asking",
          }}
          suggestions={[
            "Summarize this ticket",
            "Who is this customer and how valuable are they?",
            "Find similar tickets",
            "Draft a response to the customer",
          ]}
        />
      </div>
      {sidePanel === "customer" && <CustomerDetails />}
    </aside>
  );
}
