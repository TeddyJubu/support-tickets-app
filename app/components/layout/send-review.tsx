"use client";

// Sending controls: the Read & write switch, the review-then-confirm dialog, and the banner
// for a reply whose delivery nobody could confirm.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Loader2, Lock, LockOpen, Mail, Send, X, CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboard } from "../context/dashboard-context";

// Re-renders every second while a countdown is on screen
function useNow(active: boolean) {
  const subscribe = (cb: () => void) => {
    if (!active) return () => {};
    const t = setInterval(cb, 1000);
    return () => clearInterval(t);
  };
  return useSyncExternalStore(subscribe, () => (active ? Math.floor(Date.now() / 1000) : 0), () => 0);
}

export function SendAccessSwitch() {
  const { sendAccessUntil, setSendAccess } = useDashboard();
  const [busy, setBusy] = useState(false);
  const now = useNow(!!sendAccessUntil);
  const left = sendAccessUntil ? Math.max(0, Date.parse(sendAccessUntil) / 1000 - now) : 0;
  const on = !!sendAccessUntil && left > 0;
  const toggle = async () => {
    setBusy(true);
    await setSendAccess(!on);
    setBusy(false);
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      disabled={busy}
      title={on ? "Sending is on for this page. Click to turn it off." : "Replies can't be sent until you turn this on (30 minutes, this page only)"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
        on ? "bg-success/10 text-success ring-success/30" : "bg-muted text-muted-foreground ring-border hover:text-foreground",
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : on ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
      {on ? `Sending enabled · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")} left · this page` : "Enable sending for 30 minutes"}
    </button>
  );
}

const RECOVERY: Record<string, string> = {
  newer_message: "Close this and read the customer's new message, then review again.",
  changed_reply: "Close this and review the reply again.",
  changed_recipient: "Close this and review the reply again.",
  review_expired: "Close this and review the reply again.",
  no_review: "Close this and review the reply again.",
  pending_send: "Close this and check the earlier reply's status above the reply box.",
  uncertain: "Don't send it again yet. Check the status above the reply box once this closes.",
  read_only: "Enable sending for 30 minutes, then review again.",
};

export function ReviewDialog() {
  const { review, cancelReview, confirmReview } = useDashboard();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const open = !!review;
  // On open: focus Confirm; on close: focus returns to where it was
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    (confirmRef.current ?? dialogRef.current?.querySelector<HTMLElement>("button:not([disabled])"))?.focus();
    return () => previous?.focus?.();
  }, [open]);
  // Escape cancels (unless sending); Tab stays inside the dialog
  useEffect(() => {
    if (!review) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return void (!review.busy && cancelReview());
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialogRef.current.contains(active) || (e.shiftKey ? active === first : active === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [review, cancelReview]);
  if (!review) return null;
  const { data, error, busy } = review;
  const email = data.channel === "email";
  const blocked = !!error && error.code !== "network" && error.code !== "not_sent" && error.code !== "sent_not_saved";

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && cancelReview()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="review-title" className="flex max-h-[90dvh] w-full max-w-xl flex-col rounded-2xl border border-border bg-card shadow-pop">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <Mail className="size-4 text-primary" />
          <h2 id="review-title" className="text-base font-semibold">
            Review before sending
          </h2>
          <button type="button" onClick={cancelReview} disabled={busy} aria-label="Close" className="ml-auto rounded-lg p-1 hover:bg-accent disabled:opacity-40">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted-foreground">To</dt>
            <dd className="font-medium">
              {data.recipient}
              {email ? (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning/12 px-2 py-0.5 text-[11px] font-medium text-warning">
                  <AlertTriangle className="size-3" /> Real email
                </span>
              ) : (
                <span className="ml-2 rounded-full bg-chart-5/10 px-2 py-0.5 text-[11px] text-chart-5">Simulated customer</span>
              )}
            </dd>
            {data.subject && (
              <>
                <dt className="text-muted-foreground">Subject</dt>
                <dd>{data.subject}</dd>
              </>
            )}
            {review.closeAfter && (
              <>
                <dt className="text-muted-foreground">Then</dt>
                <dd>Close the ticket</dd>
              </>
            )}
          </dl>
          {data.answering && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">In reply to the customer&apos;s latest message</p>
              <blockquote className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border-l-2 border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {data.answering.excerpt}
              </blockquote>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Exactly what will be sent</p>
            <div className="whitespace-pre-wrap rounded-lg bg-background px-3 py-2.5 ring-1 ring-border">{review.body}</div>
          </div>
          {error && (
            <div role="alert" className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <p className="font-medium">{error.message}</p>
              {RECOVERY[error.code] && <p className="mt-0.5 text-xs">{RECOVERY[error.code]}</p>}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={cancelReview} disabled={busy} className="h-9 rounded-lg px-3 text-sm font-medium ring-1 ring-border hover:bg-accent disabled:opacity-40">
            {blocked ? "Close" : "Back to edit"}
          </button>
          {!blocked && (
            <button
              ref={confirmRef}
              type="button"
              onClick={confirmReview}
              disabled={busy}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-soft hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {busy ? "Sending…" : error ? "Confirm again" : "Confirm & send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A reply whose delivery isn't confirmed: new replies wait until a person settles it */
export function PendingSendBanner() {
  const { ticketDetail, refreshSelected, resolvePendingSend } = useDashboard();
  const [asking, setAsking] = useState<"sent" | "not_sent" | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = ticketDetail?.pendingSend;
  if (!pending) return null;
  const at = new Date(pending.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <div role="status" className="mb-2 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {pending.uncertain ? `A reply from ${at} may or may not have reached the customer.` : `A reply from ${at} is still sending…`}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">&ldquo;{pending.excerpt}&rdquo;</p>
          <p className="mt-1 text-xs text-muted-foreground">
            New replies are paused until this is settled, so the customer never gets the same email twice.
            {pending.uncertain && " Check the support mailbox's Sent folder or ask the customer, then record what happened."}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
        <button type="button" onClick={() => refreshSelected()} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 ring-border hover:bg-accent">
          <RefreshCw className="size-3.5" /> Check status
        </button>
        {pending.uncertain &&
          (asking ? (
            <>
              <span className="text-xs">{asking === "sent" ? "Record it as sent?" : "Allow sending again? Only if you're sure it didn't go out."}</span>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await resolvePendingSend(asking);
                  setBusy(false);
                  setAsking(null);
                }}
                className="h-7 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
              >
                Yes
              </button>
              <button type="button" onClick={() => setAsking(null)} className="h-7 rounded-lg px-2.5 text-xs hover:bg-accent">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setAsking("sent")} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 ring-border hover:bg-accent">
                <CheckCircle2 className="size-3.5" /> It went out
              </button>
              <button type="button" onClick={() => setAsking("not_sent")} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 ring-border hover:bg-accent">
                <X className="size-3.5" /> It didn&apos;t go out
              </button>
            </>
          ))}
      </div>
    </div>
  );
}
