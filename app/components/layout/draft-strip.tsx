"use client";

// The AI's suggested reply for the open inbox ticket, prepared in the background by the
// worker. Staff choose: use it (into the reply box), edit it with AI, copy, or dismiss.
// "Needs staff input" drafts can't be used as-is: they list what a person must check.

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Copy,
  Check,
  X,
  ChevronDown,
  ShieldAlert,
  BookOpen,
  Wand2,
  ClipboardList,
  CornerDownLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AiDraftState, DraftInfo } from "@/lib/helpdesk-types";
import { useDashboard } from "../context/dashboard-context";
import { apiJson, jsonInit } from "../api";
import { copyText, PRIORITY_META } from "../ui";

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");

function Shell({ tone = "default", children }: { tone?: "default" | "warn" | "muted"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mb-3 rounded-xl border px-4 py-3 text-sm",
        tone === "default" && "border-primary/25 bg-primary/5",
        tone === "warn" && "border-warning/40 bg-warning/5",
        tone === "muted" && "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

function RewriteBox({ draft, onDone }: { draft: DraftInfo; onDone: () => void }) {
  const { composeText, setComposeText, notify, selectedTicketId } = useDashboard();
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instruction.trim()) return setError("Say how to change the reply");
    const mine = ++request.current;
    const ticket = selectedTicketId;
    setBusy(true);
    setError(null);
    try {
      const out = await apiJson<{ text: string }>(`/api/helpdesk/drafts/${draft.id}/rewrite`, jsonInit("POST", { instruction, text: composeText || draft.body }));
      // Drop answers that arrive after the agent moved on
      if (mine !== request.current || ticket !== selectedTicketId) return;
      setComposeText(out.text);
      notify("Rewritten into the reply box: check it before sending", "info");
      onDone();
    } catch (err) {
      if (mine === request.current) setError(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      if (mine === request.current) setBusy(false);
    }
  };
  return (
    <form onSubmit={run} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={instruction}
        onChange={(e) => {
          setInstruction(e.target.value);
          setError(null);
        }}
        maxLength={1000}
        placeholder="e.g. shorter, warmer, mention store credit"
        aria-label="How to change the reply"
        className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring"
      />
      <button type="submit" disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
        Rewrite
      </button>
      <button type="button" onClick={onDone} aria-label="Cancel" className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-accent">
        <X className="size-4" />
      </button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </form>
  );
}

export function DraftStrip({ ai }: { ai: AiDraftState | undefined }) {
  const { ticketDetail, refreshSelected, setComposeText, composeText, notify } = useDashboard();
  const [expanded, setExpanded] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const ticketId = ticketDetail?.ticket.id;
  const job = ai?.job ?? null;
  const draft = ai?.draft ?? null;
  const working = job && ["pending", "processing", "retry_wait"].includes(job.state);

  // Poll faster while the worker is on it
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => refreshSelected(), 3000);
    return () => clearInterval(t);
  }, [working, refreshSelected]);

  const hasCustomerMessage = ticketDetail?.messages?.some((m) => m.author === "customer");
  if (!ticketDetail?.ticket.simulated || !hasCustomerMessage) return null;

  const act = async (state: "used" | "dismissed" | "ready") => {
    if (!draft) return false;
    setBusy(true);
    try {
      await apiJson(`/api/helpdesk/drafts/${draft.id}`, jsonInit("PATCH", { state }));
      await refreshSelected();
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn't update the draft", "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    setBusy(true);
    try {
      await apiJson(`/api/helpdesk/sim/tickets/${ticketId}/draft`, jsonInit("POST"));
      await refreshSelected();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn't queue a draft", "error");
    } finally {
      setBusy(false);
    }
  };
  const retryButton = (label: string) => (
    <button type="button" onClick={retry} disabled={busy} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50">
      <RotateCcw className="size-3.5" />
      {label}
    </button>
  );

  // Queuing a job supersedes the ticket's ready draft, so a working job is always the newest state
  if (working) {
    return (
      <Shell tone="muted">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" />
          {job.state === "retry_wait"
            ? `AI draft delayed (${job.error ?? "temporary error"}). Retrying at ${time(job.runAfter)}, attempt ${job.attempts + 1} of 3.`
            : "AI is drafting a reply…"}
        </span>
      </Shell>
    );
  }

  if (!draft || draft.state === "superseded") {
    if (job?.state === "failed") {
      return (
        <Shell tone="warn">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <span className="font-medium">AI draft unavailable</span>
            <span className="text-muted-foreground">{job.error}</span>
            <span className="ml-auto">{retryButton("Retry AI draft")}</span>
          </div>
        </Shell>
      );
    }
    if (job?.state === "skipped") {
      return (
        <Shell tone="muted">
          <div className="flex flex-wrap items-center gap-2">
            <Check className="size-4" />
            <span>No reply drafted: {job.reason ?? "nothing to answer"}.</span>
            <span className="ml-auto">{retryButton("Draft anyway")}</span>
          </div>
        </Shell>
      );
    }
    if (!job) {
      return (
        <Shell tone="muted">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4" />
            <span>No AI draft for this ticket yet.</span>
            <span className="ml-auto">{retryButton("Draft a reply")}</span>
          </div>
        </Shell>
      );
    }
    return null;
  }

  if (draft.state === "dismissed" || draft.state === "used") {
    return (
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="size-3.5" />
        AI draft {draft.state === "used" ? "used" : "dismissed"}.
        <button type="button" onClick={() => act("ready")} disabled={busy} className="font-medium text-primary hover:underline">
          Show it again
        </button>
      </div>
    );
  }

  const needsStaff = draft.action === "needs_staff";
  const severity = PRIORITY_META[draft.severity] ?? PRIORITY_META.normal;
  const use = async () => {
    if (composeText.trim() && composeText !== draft.body && !window.confirm("Replace what's in the reply box with the AI draft?")) return;
    setComposeText(draft.body);
    await act("used");
    document.getElementById("reply-box")?.focus();
  };

  return (
    <Shell tone={needsStaff ? "warn" : "default"}>
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <span className="font-medium">{needsStaff ? "Needs staff input" : "AI draft"}</span>
        {draft.severity !== "normal" && <span className={cn("text-xs font-medium", severity.tone)}>{severity.label} priority</span>}
        {draft.sensitive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive" title="Refunds, damage, cancellations… check carefully">
            <ShieldAlert className="size-3" /> Sensitive
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{time(draft.createdAt)}</span>
      </div>

      {needsStaff && (draft.staffNextStep || draft.missingFacts.length > 0) && (
        <div className="mt-2 rounded-lg bg-background/70 p-2.5 text-xs">
          {draft.staffNextStep && (
            <p className="flex gap-1.5">
              <ClipboardList className="mt-px size-3.5 shrink-0" />
              <span>
                <span className="font-medium">Next step: </span>
                {draft.staffNextStep}
              </span>
            </p>
          )}
          {draft.missingFacts.length > 0 && (
            <p className="mt-1">
              <span className="font-medium">Missing: </span>
              {draft.missingFacts.join(" · ")}
            </p>
          )}
        </div>
      )}

      {draft.body && (
        <div className="relative mt-2">
          <p className={cn("whitespace-pre-wrap text-sm leading-relaxed text-foreground", !expanded && "line-clamp-4")}>{draft.body}</p>
          <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
            {expanded ? "Less" : "Expand"}
          </button>
        </div>
      )}
      {!draft.body && needsStaff && <p className="mt-2 text-xs text-muted-foreground">No suggested text: write this reply yourself.</p>}

      {(draft.kbRefs.length > 0 || draft.flags.length > 0) && (
        <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
          {draft.kbRefs.length > 0 && (
            <p className="flex gap-1">
              <BookOpen className="mt-px size-3 shrink-0" />
              Based on: {draft.kbRefs.slice(0, 4).join(" · ")}
            </p>
          )}
          {draft.flags.map((f) => (
            <p key={f} className="flex gap-1">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              {f}
            </p>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {draft.body && (
          <button
            type="button"
            onClick={use}
            disabled={needsStaff || busy}
            title={needsStaff ? "A person needs to check the facts first: copy it or write your own" : "Put this draft in the reply box"}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow-soft hover:bg-primary/90 disabled:opacity-40"
          >
            <CornerDownLeft className="size-3.5" />
            Use draft
          </button>
        )}
        {draft.body && (
          <button type="button" onClick={() => setRewriting((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 ring-border hover:bg-accent">
            <Wand2 className="size-3.5" />
            Edit with AI
          </button>
        )}
        {draft.body && (
          <button
            type="button"
            onClick={async () => {
              const ok = await copyText(draft.body);
              setCopied(ok);
              if (!ok) notify("Couldn't copy: the browser blocked clipboard access", "error");
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 ring-border hover:bg-accent"
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            Copy
          </button>
        )}
        <button type="button" onClick={() => act("dismissed")} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent">
          <X className="size-3.5" />
          Dismiss
        </button>
        <span className="ml-auto">{retryButton("New draft")}</span>
      </div>
      {rewriting && <RewriteBox draft={draft} onDone={() => setRewriting(false)} />}
    </Shell>
  );
}
