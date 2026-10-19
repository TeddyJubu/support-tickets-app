"use client";

import { cn } from "@/lib/utils";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useCopilot } from "@yourgpt/copilot-sdk/react";
import { Send, Sparkles, Loader2, Mail, Info, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { useDashboard } from "../context/dashboard-context";
import { Kbd, modKey } from "../ui";

export function MessageComposer() {
  const {
    composeText,
    setComposeText,
    sendAgentMessage,
    setTicketStatus,
    ticketDetail,
    ticketStatus,
    sending,
    setSidePanel,
  } = useDashboard();
  const { sendMessage, isLoading: copilotBusy } = useCopilot();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const ticket = ticketDetail?.ticket;
  const isEmail = ticket?.tags === "email";
  const archived = !ticket?.simulated;
  const recipientName = ticketDetail?.customer?.name ?? ticket?.customerName ?? "the customer";
  const recipientEmail = ticketDetail?.customer?.email ?? ticket?.customerEmail;
  const canSend = composeText.trim().length > 0 && !sending;

  // Grow with the text, up to a cap
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [composeText]);

  // A drafted reply lands here from the copilot: bring it into focus
  const prevText = useRef(composeText);
  useEffect(() => {
    if (!prevText.current && composeText.length > 40) textareaRef.current?.focus();
    prevText.current = composeText;
  }, [composeText]);

  const send = async (thenClose = false) => {
    if (!canSend || !ticket) return;
    // Close the ticket the reply went to, even if the agent has moved on
    const id = ticket.id;
    const ok = await sendAgentMessage(composeText, "Email", ticket.subject ? `Re: ${ticket.subject}` : undefined);
    if (ok && thenClose && !archived) await setTicketStatus("closed", id);
  };

  const draftWithAi = () => {
    setSidePanel("copilot");
    sendMessage("Draft a response to the customer");
  };

  return (
    <div className="border-t border-border bg-background px-6 pb-4 pt-3">
      <div className="mx-auto w-full max-w-3xl">
        {/* Who this goes to */}
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Mail className="size-3.5" />
          <span>
            Reply to <span className="font-medium text-foreground">{recipientName}</span>
            {recipientEmail && <span className="hidden sm:inline"> &lt;{recipientEmail}&gt;</span>}
          </span>
          {isEmail ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-2 py-0.5 font-medium text-warning">
              <AlertTriangle className="size-3" />
              Sends a real email
            </span>
          ) : archived ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
              <Info className="size-3" />
              Archived ticket: replies stay in this view and aren&apos;t sent
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-chart-5/10 px-2 py-0.5 text-chart-5">
              Simulated customer replies automatically
            </span>
          )}
        </div>

        <div
          className={cn(
            "rounded-xl border bg-card shadow-soft transition-all focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15",
            sending ? "border-input opacity-70" : "border-input",
          )}
        >
          <textarea
            ref={textareaRef}
            id="reply-box"
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send(e.shiftKey);
              } else if (e.key === "Escape") {
                e.currentTarget.blur();
              }
            }}
            disabled={sending}
            placeholder={`Write a reply to ${recipientName.split(" ")[0]}…`}
            aria-label="Reply"
            rows={3}
            className="block max-h-[40vh] min-h-[4.5rem] w-full resize-none bg-transparent px-4 pt-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-2 px-2 pb-2 pt-1">
            <button
              type="button"
              onClick={draftWithAi}
              disabled={copilotBusy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-primary transition-colors hover:bg-accent disabled:opacity-50"
            >
              {copilotBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Draft with AI
            </button>
            {composeText && !sending && (
              <button
                type="button"
                onClick={() => {
                  setComposeText("");
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
              to send
            </span>

            {!archived && ticketStatus !== "closed" && (
              <button
                type="button"
                onClick={() => send(true)}
                disabled={!canSend}
                title={`Send and close the ticket (${modKey()}+Shift+Enter)`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-foreground ring-1 ring-border transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
              >
                <CheckCircle2 className="size-4" />
                <span className="hidden lg:inline">Send &amp; close</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => send()}
              disabled={!canSend}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-3.5" />}
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
