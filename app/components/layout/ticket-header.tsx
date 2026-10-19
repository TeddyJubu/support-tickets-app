"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  Zap,
  DollarSign,
  RotateCcw,
  ArrowRightLeft,
  PhoneCall,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Lock,
  Sparkles,
  UserRound,
  Check,
  Clock,
  CircleDot,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatIntent } from "@/lib/helpdesk-format";
import { useDashboard } from "../context/dashboard-context";
import { IconButton, Kbd, Skeleton, StatusBadge, STATUS_META } from "../ui";
import type { TicketStatus } from "../types";

function StatusMenu({ disabled }: { disabled: boolean }) {
  const { ticketStatus, setTicketStatus } = useDashboard();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options: Array<[TicketStatus, typeof CircleDot, string, string]> = [
    ["open", CircleDot, "text-info", "Needs a reply from you"],
    ["pending", Clock, "text-warning", "Waiting on the customer"],
    ["closed", CheckCircle2, "text-muted-foreground", "Done, no action needed"],
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change status"
        className="inline-flex items-center gap-1 rounded-full transition-opacity hover:opacity-80 disabled:pointer-events-none"
      >
        <StatusBadge status={ticketStatus} className="py-1 text-xs" />
        {!disabled && <ChevronDown className="size-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1.5 w-60 origin-top-left rounded-xl border border-border bg-popover p-1 shadow-pop animate-in fade-in zoom-in-95 duration-100"
        >
          {options.map(([value, Icon, tone, hint]) => (
            <button
              key={value}
              role="menuitemradio"
              aria-checked={ticketStatus === value}
              type="button"
              onClick={() => {
                setOpen(false);
                if (value !== ticketStatus) setTicketStatus(value);
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-accent"
            >
              <Icon className={cn("mt-0.5 size-4", tone)} />
              <span className="flex-1">
                <span className="block text-sm font-medium text-popover-foreground">
                  {STATUS_META[value].label}
                </span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
              {ticketStatus === value && <Check className="mt-0.5 size-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionChip({
  icon: Icon,
  tone,
  children,
}: {
  icon: typeof Zap;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        tone,
      )}
    >
      <Icon className="size-3" />
      {children}
    </span>
  );
}

export function TicketHeader() {
  const {
    ticketStatus,
    sentiment,
    appliedResolution,
    sentOffer,
    refundProcessed,
    exchangeProcessed,
    callbackScheduled,
    escalatedTo,
    ticketDetail,
    detailLoading,
    selectAdjacentTicket,
    setTicketStatus,
    tickets,
    selectedTicketId,
    sidePanel,
    setSidePanel,
    notify,
  } = useDashboard();
  const ticket = ticketDetail?.ticket;
  const index = tickets.findIndex((t) => t.id === selectedTicketId);
  const editable = !!ticket?.simulated;

  const meta = ticket
    ? [
        ticketDetail?.customer?.name ?? ticket.customerName ?? ticket.customerEmail,
        ticket.orderName ? `Order ${ticket.orderName}` : null,
        formatIntent(ticket.aiIntent),
        `Opened ${formatDate(ticket.createdAt)}`,
      ].filter(Boolean)
    : [];

  const hasActions =
    appliedResolution || sentOffer || refundProcessed || exchangeProcessed || callbackScheduled || escalatedTo;

  return (
    <header className="relative z-20 border-b border-border bg-background">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Prev / next */}
        <div className="flex shrink-0 flex-col items-center rounded-lg ring-1 ring-border">
          <button
            type="button"
            aria-label="Previous ticket (K)"
            title="Previous ticket (K)"
            disabled={index <= 0}
            onClick={() => selectAdjacentTicket(-1)}
            className="flex h-4 w-7 items-center justify-center rounded-t-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Next ticket (J)"
            title="Next ticket (J)"
            disabled={index < 0 || index >= tickets.length - 1}
            onClick={() => selectAdjacentTicket(1)}
            className="flex h-4 w-7 items-center justify-center rounded-b-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>

        {/* Title */}
        <div className={cn("min-w-0 flex-1 transition-opacity", detailLoading && "opacity-50")}>
          {ticket ? (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                  {ticket.subject ?? "(no subject)"}
                </h2>
                {sentiment && (
                  <span className="text-base leading-none" title={`Sentiment: ${sentiment.label} (${sentiment.score}/100)`}>
                    {sentiment.emoji}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <button
                  type="button"
                  title="Copy ticket ID"
                  onClick={() => {
                    navigator.clipboard?.writeText(ticket.id);
                    notify(`Copied ${ticket.id}`, "info");
                  }}
                  className="group inline-flex shrink-0 items-center gap-1 rounded font-mono text-[11px] hover:text-foreground"
                >
                  {ticket.id}
                  <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
                {ticket.simulated && ticket.tags !== "email" && (
                  <span className="shrink-0 rounded bg-chart-5/12 px-1.5 py-px text-[10px] font-semibold text-chart-5">
                    SIMULATED
                  </span>
                )}
                {ticket.tags === "email" && (
                  <span className="shrink-0 rounded bg-info/12 px-1.5 py-px text-[10px] font-semibold text-info">
                    REAL EMAIL
                  </span>
                )}
                <span className="truncate">· {meta.join(" · ")}</span>
              </div>
            </>
          ) : (
            <div className="space-y-1.5 py-0.5">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-80" />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {ticket && (editable ? <StatusMenu disabled={detailLoading} /> : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
              title="Archived Gorgias tickets can't be changed"
            >
              <Lock className="size-3" />
              Read-only
            </span>
          ))}

          {ticket?.url && (
            <a
              href={ticket.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors hover:bg-accent hover:text-foreground"
            >
              Gorgias
              <ExternalLink className="size-3.5" />
            </a>
          )}

          {editable && (
            <button
              type="button"
              onClick={() => setTicketStatus(ticketStatus === "closed" ? "open" : "closed")}
              disabled={detailLoading}
              title={ticketStatus === "closed" ? "Reopen ticket" : "Close ticket (E)"}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium shadow-soft transition-all active:scale-[0.98] disabled:opacity-50",
                ticketStatus === "closed"
                  ? "bg-background text-foreground ring-1 ring-border hover:bg-accent"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {ticketStatus === "closed" ? (
                <>
                  <RotateCcw className="size-3.5" />
                  Reopen
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4" />
                  Close ticket
                  <Kbd className="ml-0.5 border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground">E</Kbd>
                </>
              )}
            </button>
          )}

          <div className="ml-1 flex items-center gap-0.5 border-l border-border pl-2">
            <IconButton
              label="Customer details"
              active={sidePanel === "customer"}
              onClick={() => setSidePanel(sidePanel === "customer" ? null : "customer")}
            >
              <UserRound className="size-4" />
            </IconButton>
            <IconButton
              label="AI copilot"
              active={sidePanel === "copilot"}
              onClick={() => setSidePanel(sidePanel === "copilot" ? null : "copilot")}
            >
              <Sparkles className="size-4" />
            </IconButton>
          </div>
        </div>
      </div>

      {hasActions && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5">
          {appliedResolution && (
            <ActionChip icon={Zap} tone="bg-chart-1/10 text-chart-1 ring-chart-1/25">
              {appliedResolution}
            </ActionChip>
          )}
          {sentOffer && (
            <ActionChip icon={DollarSign} tone="bg-success/10 text-success ring-success/25">
              {sentOffer.type}: {sentOffer.value}
            </ActionChip>
          )}
          {refundProcessed && (
            <ActionChip icon={RotateCcw} tone="bg-info/10 text-info ring-info/25">
              Refund: ${refundProcessed.amount}
            </ActionChip>
          )}
          {exchangeProcessed && (
            <ActionChip icon={ArrowRightLeft} tone="bg-warning/10 text-warning ring-warning/25">
              Exchange: {exchangeProcessed.to}
            </ActionChip>
          )}
          {callbackScheduled && (
            <ActionChip icon={PhoneCall} tone="bg-chart-2/10 text-chart-2 ring-chart-2/25">
              Callback: {callbackScheduled.date} {callbackScheduled.time}
            </ActionChip>
          )}
          {escalatedTo && (
            <ActionChip icon={AlertTriangle} tone="bg-destructive/10 text-destructive ring-destructive/25">
              Escalated: {escalatedTo}
            </ActionChip>
          )}
        </div>
      )}
    </header>
  );
}
