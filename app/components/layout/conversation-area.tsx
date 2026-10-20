"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Inbox, AlertCircle, RefreshCw, ChevronUp } from "lucide-react";
import { formatDay } from "@/lib/helpdesk-format";
import { useDashboard } from "../context/dashboard-context";
import { Skeleton } from "../ui";
import { Message } from "./message";
import { MessageComposer } from "./message-composer";
import { DraftStrip } from "./draft-strip";
import { ReviewDialog } from "./send-review";

function ConversationSkeleton() {
  return (
    <div className="space-y-6 py-4" aria-hidden>
      <Skeleton className="mx-auto h-6 w-56 rounded-full" />
      {[0, 1, 0].map((agent, i) => (
        <div key={i} className={agent ? "flex flex-row-reverse gap-3" : "flex gap-3"}>
          <Skeleton className="size-7 rounded-full" />
          <div className={agent ? "flex w-1/2 flex-col items-end space-y-2" : "w-3/5 space-y-2"}>
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Long threads open on the newest messages; older ones load on request
const RECENT = 30;

export function ConversationArea() {
  const { messages, ticketDetail, selectedTicketId, detailError, ticketsLoading, selectTicket } =
    useDashboard();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTicket = useRef<string | null>(null);
  const lastCount = useRef(0);
  // Only the selected ticket's own detail is shown, so the composer can't reply to the wrong one
  const loaded = !!ticketDetail && ticketDetail.ticket.id === selectedTicketId;
  // How many messages to show, per ticket (resets when another ticket opens)
  const [shown, setShown] = useState<{ ticket: string | null; count: number }>({ ticket: null, count: RECENT });
  const limit = shown.ticket === selectedTicketId ? shown.count : RECENT;
  const hidden = Math.max(0, messages.length - limit);
  const visible = hidden ? messages.slice(hidden) : messages;

  // Jump to the newest message when a ticket opens; glide when a new one arrives
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = ticketDetail?.ticket.id ?? null;
    if (id !== lastTicket.current) {
      el.scrollTop = el.scrollHeight;
    } else if (messages.length > lastCount.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    lastTicket.current = id;
    lastCount.current = messages.length;
  }, [messages, ticketDetail?.ticket.id]);

  // Keep the reading position stable while the composer grows
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const empty = !selectedTicketId && !ticketsLoading;
  // Day divider above the first message of each day
  const dividers: Array<string | null> = [];
  let lastDay: string | null = null;
  for (const msg of visible) {
    const day = formatDay(msg.date);
    dividers.push(day && day !== lastDay ? day : null);
    if (day) lastDay = day;
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {empty ? (
            <div className="flex flex-col items-center py-24 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <Inbox className="size-6" />
              </div>
              <p className="mt-4 text-base font-semibold text-foreground">No ticket selected</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Pick a ticket from the list to read the conversation and reply.
              </p>
            </div>
          ) : detailError && !loaded ? (
            <div className="flex flex-col items-center py-24 text-center" role="alert">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <AlertCircle className="size-6" />
              </div>
              <p className="mt-4 text-base font-semibold text-foreground">Couldn&apos;t open this ticket</p>
              <p className="mt-1 text-sm text-muted-foreground">{detailError}</p>
              <button
                type="button"
                onClick={() => selectedTicketId && selectTicket(selectedTicketId)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-soft ring-1 ring-border hover:bg-accent"
              >
                <RefreshCw className="size-3.5" />
                Try again
              </button>
            </div>
          ) : !loaded ? (
            <ConversationSkeleton />
          ) : (
            <div className="space-y-1 animate-in fade-in duration-200">
              {hidden > 0 && (
                <div className="flex justify-center pb-2">
                  <button
                    type="button"
                    onClick={() => setShown({ ticket: selectedTicketId, count: limit + RECENT })}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <ChevronUp className="size-3.5" />
                    Show {Math.min(hidden, RECENT)} older message{Math.min(hidden, RECENT) === 1 ? "" : "s"} ({hidden} hidden)
                  </button>
                </div>
              )}
              {visible.map((msg, i) => {
                const day = dividers[i];
                return (
                  <Fragment key={msg.id}>
                    {day && (
                      <div className="flex items-center gap-3 py-3" role="separator">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          {day}
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    <Message message={msg} />
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {loaded && ticketDetail.ticket.simulated && (
        <div className="mx-auto w-full max-w-3xl px-6">
          <DraftStrip key={ticketDetail.ticket.id} ai={ticketDetail.ai} />
        </div>
      )}
      {loaded && <MessageComposer key={ticketDetail.ticket.id} />}
      <ReviewDialog />
    </div>
  );
}
