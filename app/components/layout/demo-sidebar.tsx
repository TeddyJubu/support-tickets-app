"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import {
  MoreHorizontal,
  Search,
  HelpCircle,
  Shield,
  Link2,
  Loader2,
} from "lucide-react";
import { formatDate } from "@/lib/helpdesk-format";
import { useDashboard } from "../context/dashboard-context";

// Geometric logo component for SupportDesk
function SupportDeskLogo() {
  return (
    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sidebar-primary to-sidebar-primary/70 flex items-center justify-center relative overflow-hidden">
      {/* Abstract ticket/chat bubble shape */}
      <div className="relative w-6 h-6">
        {/* Main square (ticket) */}
        <div className="absolute inset-0 bg-sidebar-primary-foreground/90 rounded-sm transform rotate-3" />
        {/* Corner fold */}
        <div className="absolute top-0 right-0 w-2 h-2 bg-sidebar-primary/50 rounded-bl-sm" />
        {/* Lines representing text */}
        <div className="absolute top-1.5 left-1 right-2 space-y-1">
          <div className="h-0.5 bg-sidebar-primary/40 rounded-full w-full" />
          <div className="h-0.5 bg-sidebar-primary/40 rounded-full w-3/4" />
          <div className="h-0.5 bg-sidebar-primary/40 rounded-full w-1/2" />
        </div>
      </div>
      {/* Subtle corner accent */}
      <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-sidebar-primary-foreground/10 rounded-full blur-sm" />
    </div>
  );
}

export function DemoSidebar() {
  const {
    linkedTickets,
    customerRisk,
    sentiment,
    tickets,
    ticketTotal,
    ticketQuery,
    ticketsLoading,
    ticketsError,
    retryTickets,
    setTicketQuery,
    loadMoreTickets,
    selectedTicketId,
    selectTicket,
    ticketSource,
    setTicketSource,
  } = useDashboard();

  // Load the next page when the end of the list scrolls into view
  const sentinelRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMoreTickets();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMoreTickets]);

  return (
    <aside className="w-56 bg-sidebar border-r border-sidebar-border flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <SupportDeskLogo />
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sidebar-foreground text-sm">
              SupportDesk
            </h1>
            <p className="text-xs text-muted-foreground">AI-Powered Help</p>
          </div>
          <button className="p-1 text-muted-foreground hover:text-sidebar-foreground">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* AI Insights Quick View */}
      {(customerRisk || sentiment) && (
        <div className="p-3 border-b border-sidebar-border space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase">
            AI Insights
          </div>
          {customerRisk && (
            <div
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs",
                customerRisk.level === "low"
                  ? "bg-green-500/10 text-green-600"
                  : customerRisk.level === "medium"
                    ? "bg-yellow-500/10 text-yellow-600"
                    : "bg-red-500/10 text-red-600",
              )}
            >
              <Shield className="w-3 h-3" />
              <span className="capitalize">{customerRisk.level} Risk</span>
              <span className="ml-auto font-medium">
                {customerRisk.score}/100
              </span>
            </div>
          )}
          {sentiment && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-sidebar-accent text-xs text-sidebar-foreground">
              <span>{sentiment.emoji}</span>
              <span>{sentiment.label}</span>
              <span className="ml-auto font-medium">{sentiment.score}/100</span>
            </div>
          )}
        </div>
      )}

      {/* Source tabs */}
      <div className="px-3 pt-3">
        <div className="grid grid-cols-2 gap-1 p-1 bg-sidebar-accent rounded-lg text-xs">
          {(
            [
              ["sim", "Simulated"],
              ["history", "History"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => value !== ticketSource && setTicketSource(value)}
              className={cn(
                "py-1.5 rounded-md transition-colors",
                ticketSource === value
                  ? "bg-background text-sidebar-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-sidebar-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="p-3">
        <label className="flex items-center gap-2 px-3 py-2 bg-sidebar-accent rounded-lg text-muted-foreground text-sm focus-within:ring-1 focus-within:ring-ring">
          <Search className="w-4 h-4 shrink-0" />
          <input
            value={ticketQuery}
            onChange={(e) => setTicketQuery(e.target.value)}
            placeholder="Search tickets"
            className="w-full bg-transparent outline-none text-sidebar-foreground placeholder:text-muted-foreground"
          />
          {ticketsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
        </label>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        <div className="flex items-center justify-between px-3 pb-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Tickets
          </h3>
          <span className="text-xs text-muted-foreground">
            {ticketTotal.toLocaleString()}
          </span>
        </div>
        <ul className="space-y-0.5">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <button
                onClick={() => selectTicket(ticket.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                  ticket.id === selectedTicketId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <div className="flex items-center gap-1.5">
                  {ticket.priority && ticket.priority !== "normal" && (
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        ticket.priority === "critical" || ticket.priority === "high"
                          ? "bg-red-500"
                          : "bg-muted-foreground",
                      )}
                      title={`${ticket.priority} priority`}
                    />
                  )}
                  {ticket.simulated && ticket.status && ticket.status !== "closed" && (
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        ticket.status === "open" ? "bg-blue-500" : "bg-yellow-500",
                      )}
                      title={ticket.status === "open" ? "Waiting on agent" : "Waiting on customer"}
                    />
                  )}
                  <span className="truncate font-medium">
                    {ticket.subject ?? "(no subject)"}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate">
                    {ticket.customerName ?? ticket.customerEmail}
                  </span>
                  <span className="ml-auto shrink-0">{formatDate(ticket.createdAt)}</span>
                </div>
              </button>
            </li>
          ))}
          {tickets.length < ticketTotal && (
            <li ref={sentinelRef} className="px-3 py-2 text-xs text-muted-foreground">
              Loading more…
            </li>
          )}
          {ticketsError && (
            <li className="px-3 py-2 text-xs text-red-500">
              Couldn&apos;t load tickets ({ticketsError}).{" "}
              <button onClick={retryTickets} className="underline">
                Retry
              </button>
            </li>
          )}
          {!ticketsLoading && !ticketsError && tickets.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {ticketSource === "sim" && !ticketQuery
                ? "No simulated tickets yet. Run npm run simulate."
                : "No tickets found"}
            </li>
          )}
        </ul>

        {/* Linked Tickets */}
        {linkedTickets.length > 0 && (
          <div className="mt-6">
            <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Linked Tickets
            </h3>
            <ul className="mt-2 space-y-1">
              {linkedTickets.map((ticket) => (
                <li key={ticket.id}>
                  <a
                    href="#"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent"
                  >
                    <Link2 className="w-3 h-3 text-chart-3" />
                    <span className="truncate flex-1">#{ticket.id}</span>
                    <span
                      className={cn(
                        "text-xs px-1.5 py-0.5 rounded",
                        ticket.status === "Resolved"
                          ? "bg-green-500/20 text-green-600"
                          : "bg-yellow-500/20 text-yellow-600",
                      )}
                    >
                      {ticket.status}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border">
        <a
          href="#"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <HelpCircle className="w-4 h-4" />
          <span>Help & Support</span>
        </a>
        <div className="flex items-center gap-2 px-3 py-2 mt-2">
          <span className="text-[10px] text-muted-foreground uppercase">
            AI by
          </span>
          <span className="text-xs font-semibold text-sidebar-primary">
            Copilot SDK
          </span>
        </div>
      </div>
    </aside>
  );
}
