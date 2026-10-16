"use client";

import {
  ChevronLeft,
  ChevronRight,
  Pin,
  MoreHorizontal,
  ChevronDown,
  Zap,
  DollarSign,
  RotateCcw,
  ArrowRightLeft,
  PhoneCall,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatIntent } from "@/lib/helpdesk-format";
import { useDashboard } from "../context/dashboard-context";

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
  } = useDashboard();
  const ticket = ticketDetail?.ticket;

  const statusColors = {
    open: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    pending: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
    resolved: "bg-green-500/10 text-green-600 border-green-500/30",
    closed: "bg-muted text-muted-foreground border-border",
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card flex-wrap">
      <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-4 h-4" />
        <span className="text-sm">Ticket List</span>
      </button>
      <div className="flex items-center gap-1 text-muted-foreground">
        <button
          className="p-1 hover:bg-accent rounded"
          title="Newer ticket"
          onClick={() => selectAdjacentTicket(-1)}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          className="p-1 hover:bg-accent rounded"
          title="Older ticket"
          onClick={() => selectAdjacentTicket(1)}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className={cn("flex items-center gap-2 min-w-0", detailLoading && "opacity-60")}>
        <span className="text-sm font-semibold text-foreground">
          #{ticket?.id ?? "…"}
        </span>
        <span className="text-sm text-muted-foreground truncate max-w-[22rem]">
          {ticket ? (ticket.subject ?? "(no subject)") : "Loading ticket…"}
        </span>
        {ticket && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {[
              ticketDetail?.customer?.name ?? ticket.customerName,
              formatDate(ticket.createdAt),
              ticket.orderName ? `Order ${ticket.orderName}` : null,
              formatIntent(ticket.aiIntent),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        {ticket?.simulated && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-500">
            SIM
          </span>
        )}
        {sentiment && (
          <span className="text-lg" title={`Sentiment: ${sentiment.label}`}>
            {sentiment.emoji}
          </span>
        )}
        <button className="p-1 text-muted-foreground hover:text-foreground">
          <Pin className="w-4 h-4" />
        </button>
      </div>

      {/* Status Badge */}
      <div
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 border rounded-full text-xs font-medium capitalize",
          statusColors[ticketStatus],
        )}
      >
        {ticketStatus === "resolved" && <CheckCircle2 className="w-3 h-3" />}
        {ticketStatus}
      </div>

      {/* Action Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Applied Resolution */}
        {appliedResolution && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/10 border border-purple-500/30 rounded-full">
            <Zap className="w-3 h-3 text-purple-500" />
            <span className="text-xs text-purple-600 font-medium">
              {appliedResolution}
            </span>
          </div>
        )}

        {/* Sent Offer */}
        {sentOffer && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 border border-green-500/30 rounded-full">
            <DollarSign className="w-3 h-3 text-green-500" />
            <span className="text-xs text-green-600 font-medium">
              {sentOffer.type}: {sentOffer.value}
            </span>
          </div>
        )}

        {/* Refund Processed */}
        {refundProcessed && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/10 border border-blue-500/30 rounded-full">
            <RotateCcw className="w-3 h-3 text-blue-500" />
            <span className="text-xs text-blue-600 font-medium">
              Refund: ${refundProcessed.amount}
            </span>
          </div>
        )}

        {/* Exchange Processed */}
        {exchangeProcessed && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-500/10 border border-orange-500/30 rounded-full">
            <ArrowRightLeft className="w-3 h-3 text-orange-500" />
            <span className="text-xs text-orange-600 font-medium">
              Exchange: {exchangeProcessed.to}
            </span>
          </div>
        )}

        {/* Callback Scheduled */}
        {callbackScheduled && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded-full">
            <PhoneCall className="w-3 h-3 text-cyan-500" />
            <span className="text-xs text-cyan-600 font-medium">
              Callback: {callbackScheduled.date} {callbackScheduled.time}
            </span>
          </div>
        )}

        {/* Escalated */}
        {escalatedTo && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 border border-red-500/30 rounded-full">
            <AlertTriangle className="w-3 h-3 text-red-500" />
            <span className="text-xs text-red-600 font-medium">
              Escalated: {escalatedTo}
            </span>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {ticket?.url && (
          <a
            href={ticket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg"
            title="Open in Gorgias"
          >
            <ExternalLink className="w-5 h-5" />
          </a>
        )}
        <button className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg">
          <MoreHorizontal className="w-5 h-5" />
        </button>
        <button
          onClick={() => setTicketStatus(ticketStatus === "closed" ? "open" : "closed")}
          disabled={!ticket?.simulated}
          title={ticket?.simulated ? undefined : "Historical tickets are read-only"}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {ticketStatus === "closed" ? "Reopen" : "Submit as Closed"}
        </button>
        <button className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
