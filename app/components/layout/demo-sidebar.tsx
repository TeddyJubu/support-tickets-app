"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import {
  Search,
  Loader2,
  X,
  Inbox,
  Archive,
  Moon,
  Sun,
  Keyboard,
  Flag,
  RefreshCw,
  SearchX,
} from "lucide-react";
import { formatRelative } from "@/lib/helpdesk-format";
import type { TicketSummary } from "@/lib/helpdesk-types";
import { useDashboard, type StatusFilter } from "../context/dashboard-context";
import { Avatar, IconButton, Kbd, Skeleton, STATUS_META } from "../ui";
import type { TicketStatus } from "../types";

// A little four-hole button, for Buttons Bebe
function BrandMark() {
  return (
    <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.6_0.2_320)] shadow-soft">
      <svg viewBox="0 0 24 24" className="size-5 text-white" aria-hidden>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="9.5" cy="9.5" r="1.4" fill="currentColor" />
        <circle cx="14.5" cy="9.5" r="1.4" fill="currentColor" />
        <circle cx="9.5" cy="14.5" r="1.4" fill="currentColor" />
        <circle cx="14.5" cy="14.5" r="1.4" fill="currentColor" />
      </svg>
    </div>
  );
}

export function ticketStatusOf(ticket: Pick<TicketSummary, "status" | "closedAt">): TicketStatus {
  if (ticket.closedAt || ticket.status === "closed") return "closed";
  return ticket.status === "pending" ? "pending" : "open";
}

const FILTERS: Array<[StatusFilter, string]> = [
  ["all", "All"],
  ["open", "Needs reply"],
  ["pending", "Waiting"],
  ["closed", "Closed"],
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is only known in the browser
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const dark = mounted && resolvedTheme === "dark";
  return (
    <IconButton
      label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </IconButton>
  );
}

function TicketRow({
  ticket,
  selected,
  onSelect,
}: {
  ticket: TicketSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = ticketStatusOf(ticket);
  const needsReply = ticket.simulated && status === "open";
  const urgent = ticket.priority === "critical" || ticket.priority === "high";
  const name = ticket.customerName ?? ticket.customerEmail ?? "Unknown customer";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      data-ticket-id={ticket.id}
      className={cn(
        "group relative flex w-full gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors",
        selected
          ? "bg-sidebar-accent shadow-soft ring-1 ring-sidebar-border"
          : "hover:bg-sidebar-accent/60",
      )}
    >
      {selected && (
        <span className="absolute inset-y-2.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden />
      )}
      <Avatar name={name} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "truncate text-[13px] text-sidebar-foreground",
              needsReply ? "font-semibold" : "font-medium",
            )}
          >
            {name}
          </span>
          <span
            className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground"
            title={ticket.updatedAt ?? ticket.createdAt ?? undefined}
          >
            {formatRelative(ticket.updatedAt ?? ticket.createdAt)}
          </span>
        </div>
        <div
          className={cn(
            "truncate text-[13px]",
            needsReply ? "text-sidebar-foreground/90" : "text-muted-foreground",
          )}
        >
          {ticket.subject ?? "(no subject)"}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {ticket.simulated ? (
            <span className="inline-flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full", STATUS_META[status].dot)} />
              {STATUS_META[status].label}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full", STATUS_META[status].dot)} />
              {status === "closed" ? "Closed" : "Open"}
            </span>
          )}
          {urgent && (
            <span className="inline-flex items-center gap-0.5 text-destructive" title={`${ticket.priority} priority`}>
              <Flag className="size-3" />
              <span className="capitalize">{ticket.priority}</span>
            </span>
          )}
          {ticket.tags === "email" && (
            <span className="rounded bg-info/12 px-1 py-px text-[10px] font-medium text-info">
              Email
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] opacity-70">{ticket.id}</span>
        </div>
      </div>
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1 px-1" aria-hidden>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex gap-3 px-2.5 py-2.5">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="flex justify-between gap-6">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-8" />
            </div>
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DemoSidebar({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const {
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
    statusFilter,
    setStatusFilter,
  } = useDashboard();

  // Load the next page when the end of the list scrolls into view
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMoreTickets();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMoreTickets]);

  // Keep the selected ticket in view when moving with J/K
  useEffect(() => {
    if (!selectedTicketId) return;
    document
      .querySelector(`[data-ticket-id="${CSS.escape(selectedTicketId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedTicketId]);

  const showSkeleton = ticketsLoading && tickets.length === 0;

  return (
    <aside className="flex h-full w-[17rem] shrink-0 flex-col xl:w-[19rem] border-r border-sidebar-border bg-sidebar">
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <BrandMark />
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="text-sm font-semibold tracking-tight text-sidebar-foreground">
            Buttons Bebe
          </h1>
          <p className="text-xs text-muted-foreground">Support inbox</p>
        </div>
      </div>

      {/* Source */}
      <div className="px-3">
        <div
          role="tablist"
          aria-label="Ticket source"
          className="grid grid-cols-2 gap-1 rounded-lg bg-sidebar-accent/70 p-1 text-xs"
        >
          {(
            [
              ["sim", "Inbox", Inbox, "Simulated and emailed tickets you can reply to"],
              ["history", "Archive", Archive, "Read-only history from the Gorgias export"],
            ] as const
          ).map(([value, label, Icon, hint]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={ticketSource === value}
              title={hint}
              onClick={() => value !== ticketSource && setTicketSource(value)}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-all",
                ticketSource === value
                  ? "bg-background text-sidebar-foreground shadow-soft"
                  : "text-muted-foreground hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-3">
        <label className="group flex items-center gap-2 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-muted-foreground transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
          <Search className="size-4 shrink-0" />
          <input
            id="ticket-search"
            value={ticketQuery}
            onChange={(e) => setTicketQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setTicketQuery("");
                e.currentTarget.blur();
              }
            }}
            placeholder="Search name, email, order…"
            aria-label="Search tickets"
            className="w-full min-w-0 bg-transparent text-sidebar-foreground outline-none placeholder:text-muted-foreground"
          />
          {ticketsLoading && ticketQuery ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
          ) : ticketQuery ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setTicketQuery("")}
              className="rounded p-0.5 hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <Kbd className="group-focus-within:hidden">/</Kbd>
          )}
        </label>
      </div>

      {/* Status filter (inbox only) */}
      {ticketSource === "sim" && (
        <div className="flex gap-1 overflow-x-auto px-3 pt-2.5" role="radiogroup" aria-label="Filter by status">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={statusFilter === value}
              onClick={() => value !== statusFilter && setStatusFilter(value)}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                statusFilter === value
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-4 pb-1.5 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>{ticketQuery ? "Results" : "Tickets"}</span>
        <span className="tabular-nums normal-case tracking-normal">
          {ticketsLoading && tickets.length === 0 ? "…" : ticketTotal.toLocaleString()}
        </span>
      </div>

      {/* List */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="Tickets">
        {showSkeleton && <ListSkeleton />}
        <ul className="space-y-0.5">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <TicketRow
                ticket={ticket}
                selected={ticket.id === selectedTicketId}
                onSelect={() => selectTicket(ticket.id)}
              />
            </li>
          ))}
        </ul>
        {tickets.length > 0 && tickets.length < ticketTotal && (
          <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading more…
          </div>
        )}
        {ticketsError && (
          <div className="m-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <p className="font-medium text-destructive">Couldn&apos;t load tickets</p>
            <p className="mt-0.5 text-muted-foreground">{ticketsError}</p>
            <button
              type="button"
              onClick={retryTickets}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 font-medium text-foreground shadow-soft ring-1 ring-border hover:bg-muted"
            >
              <RefreshCw className="size-3" />
              Try again
            </button>
          </div>
        )}
        {!ticketsLoading && !ticketsError && tickets.length === 0 && (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-sidebar-accent text-muted-foreground">
              {ticketQuery ? <SearchX className="size-5" /> : <Inbox className="size-5" />}
            </div>
            <p className="mt-3 text-sm font-medium text-sidebar-foreground">
              {ticketQuery
                ? "No matching tickets"
                : statusFilter !== "all"
                  ? "Nothing here"
                  : "No tickets yet"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {ticketQuery ? (
                <>
                  Try a name, email or order number.{" "}
                  <button type="button" onClick={() => setTicketQuery("")} className="font-medium text-primary hover:underline">
                    Clear search
                  </button>
                </>
              ) : statusFilter !== "all" ? (
                <>
                  No tickets with this status.{" "}
                  <button type="button" onClick={() => setStatusFilter("all")} className="font-medium text-primary hover:underline">
                    Show all
                  </button>
                </>
              ) : ticketSource === "sim" ? (
                <>
                  Run <code className="rounded bg-muted px-1 font-mono">npm run simulate</code> to create some.
                </>
              ) : (
                "The archive is empty."
              )}
            </p>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="flex items-center gap-1 border-t border-sidebar-border px-3 py-2">
        <button
          type="button"
          onClick={onShowShortcuts}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Keyboard className="size-4" />
          Shortcuts
          <Kbd>?</Kbd>
        </button>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
