"use client";

import { cn } from "@/lib/utils";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Send,
  Loader2,
  Mail,
  CheckCircle2,
  AlertTriangle,
  X,
  StickyNote,
} from "lucide-react";
import { useDashboard } from "../context/dashboard-context";
import { Kbd, modKey } from "../ui";
import { PendingSendBanner, SendAccessSwitch } from "./send-review";

export function MessageComposer() {
  const {
    composeText,
    setComposeText,
    sendAgentMessage,
    ticketDetail,
    ticketStatus,
    sending,
    addNote,
    sendAccessUntil,
  } = useDashboard();
  // Internal notes are never sent to the customer
  const [mode, setMode] = useState<"reply" | "note">("reply");
  // A note has its own text (per ticket), so switching tabs never sends a note as a reply
  const [note, setNote] = useState({ ticketId: "", text: "" });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const ticket = ticketDetail?.ticket;
  const isEmail = ticket?.channel === "email";
  const archived = !ticket?.simulated;
  const recipientName =
    ticketDetail?.customer?.name ?? ticket?.customerName ?? "the customer";
  const recipientEmail = ticketDetail?.customer?.email ?? ticket?.customerEmail;
  const noteText = note.ticketId === ticket?.id ? note.text : "";
  const text = mode === "note" ? noteText : composeText;
  const setText = (value: string) =>
    mode === "note" ? setNote({ ticketId: ticket?.id ?? "", text: value }) : setComposeText(value);
  // Inbox replies need Read & write and no unconfirmed earlier send; notes don't
  const replyLocked =
    !archived &&
    mode === "reply" &&
    (!sendAccessUntil || !!ticketDetail?.pendingSend);
  const canSend = text.trim().length > 0 && !sending && !replyLocked;

  // Grow within the conversation so long replies use its single scrollbar.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const grow = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    grow();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      grow();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  // A drafted reply lands here from the copilot: bring it into focus
  const prevText = useRef(composeText);
  useEffect(() => {
    if (!prevText.current && composeText.length > 40)
      textareaRef.current?.focus();
    prevText.current = composeText;
  }, [composeText]);

  const send = async (thenClose = false) => {
    if (!canSend || !ticket || archived) return;
    if (mode === "note") {
      const id = ticket.id;
      if (await addNote(noteText)) setNote((n) => (n.ticketId === id ? { ticketId: id, text: "" } : n));
      return;
    }
    // Inbox tickets open Review; closing happens after the confirmed send
    if (!archived) {
      await sendAgentMessage(composeText, "Email", undefined, thenClose);
      return;
    }
  };

  if (archived) return null;

  return (
    <div className="border-t border-border bg-background px-6 pb-4 pt-3">
      <div className="mx-auto w-full max-w-3xl">
        {!archived && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-lg bg-muted p-0.5 text-xs"
              role="tablist"
              aria-label="Reply or note"
            >
              {(
                [
                  ["reply", "Reply", Mail],
                  ["note", "Internal note", StickyNote],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors",
                    mode === value
                      ? "bg-background text-foreground shadow-soft"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
            {mode === "reply" && (
              <span className="ml-auto">
                <SendAccessSwitch />
              </span>
            )}
          </div>
        )}

        {!archived && mode === "reply" && <PendingSendBanner />}
        {mode === "reply" && (
          <p id="sending-help" className="mb-2 text-xs text-muted-foreground">
            {ticketDetail?.pendingSend
              ? "Sending is blocked until you confirm the earlier reply's delivery above. You can still edit this draft."
              : !sendAccessUntil
                ? "You can write a draft. To review and send, enable sending for 30 minutes on this page. Reloading turns sending off."
                : "Sending is enabled temporarily for this page. Every reply still requires review and confirmation."}
          </p>
        )}

        {/* Who this goes to */}
        {mode === "note" ? (
          <div className="mb-2 flex items-center gap-2 text-xs text-warning">
            <StickyNote className="size-3.5" />
            Only staff see notes. The customer never receives them.
          </div>
        ) : (
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Mail className="size-3.5" />
            <span>
              Reply to{" "}
              <span className="font-medium text-foreground">
                {recipientName}
              </span>
              {recipientEmail && (
                <span className="hidden sm:inline">
                  {" "}
                  &lt;{recipientEmail}&gt;
                </span>
              )}
            </span>
            {isEmail ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-2 py-0.5 font-medium text-warning">
                <AlertTriangle className="size-3" />
                Sends a real email
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-chart-5/10 px-2 py-0.5 text-chart-5">
                Simulated customer replies automatically
              </span>
            )}
          </div>
        )}

        <div
          className={cn(
            "rounded-xl border shadow-soft transition-all focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15",
            mode === "note"
              ? "bg-warning/5 border-warning/40"
              : "bg-card border-input",
            sending && "opacity-70",
          )}
        >
          <textarea
            ref={textareaRef}
            id="reply-box"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send(e.shiftKey);
              } else if (e.key === "Escape") {
                e.currentTarget.blur();
              }
            }}
            disabled={sending}
            placeholder={
              mode === "note"
                ? "Write a note for your team…"
                : `Write a reply to ${recipientName.split(" ")[0]}…`
            }
            aria-label={mode === "note" ? "Internal note" : "Reply"}
            aria-describedby={mode === "reply" ? "sending-help" : undefined}
            rows={3}
            className="block min-h-[4.5rem] w-full resize-none overflow-hidden bg-transparent px-4 pt-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-2 px-2 pb-2 pt-1">
            {text && !sending && (
              <button
                type="button"
                onClick={() => {
                  setText("");
                  textareaRef.current?.focus();
                }}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
                Discard
              </button>
            )}

            <span className="ml-auto hidden items-center gap-1 text-[11px] text-muted-foreground md:inline-flex">
              <Kbd>{modKey()}</Kbd>
              <Kbd>↵</Kbd>
              {mode === "note" ? "to add note" : "to review"}
            </span>

            {!archived && mode === "reply" && ticketStatus !== "closed" && (
              <button
                type="button"
                onClick={() => send(true)}
                disabled={!canSend}
                title={`Send and close the ticket (${modKey()}+Shift+Enter)`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-foreground ring-1 ring-border transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
              >
                <CheckCircle2 className="size-4" />
                <span className="sr-only lg:not-sr-only">Send &amp; close</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => send()}
              disabled={!canSend}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : mode === "note" ? (
                <StickyNote className="size-3.5" />
              ) : (
                <Send className="size-3.5" />
              )}
              {sending
                ? "Working…"
                : mode === "note"
                  ? "Add note"
                  : archived
                    ? "Send"
                    : "Review & send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
