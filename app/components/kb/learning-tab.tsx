"use client";

// Lessons from delivered replies. The owner approves good ones; each night approved lessons
// are masked and added to the knowledge base as examples. Text here is already masked.

import { useCallback, useEffect, useState } from "react";
import { Check, X, GraduationCap, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lesson } from "@/lib/learning";
import { apiJson, jsonInit } from "../api";

interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  promoted: number;
  withAiDraft: number;
  aiDraftEdited: number;
}

const FILTERS = [
  ["pending", "To review"],
  ["approved", "Approved (tonight)"],
  ["promoted", "In the KB"],
  ["rejected", "Rejected"],
] as const;

export function LearningTab({ owner }: { owner: boolean }) {
  const [status, setStatus] = useState<(typeof FILTERS)[number][0]>("pending");
  const [data, setData] = useState<{ stats: Stats; lessons: Lesson[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiJson<{ stats: Stats; lessons: Lesson[] }>(`/api/learning?status=${status}`)
        .then(setData)
        .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load lessons")),
    [status],
  );
  useEffect(() => {
    load();
  }, [load]);
  const decide = async (id: number, decision: "approved" | "rejected") => {
    try {
      await apiJson(`/api/learning/${id}`, jsonInit("POST", { decision }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that");
    }
  };
  const s = data?.stats;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <GraduationCap className="size-5 text-primary" />
        <span>
          <b className="tabular-nums">{s?.total ?? "…"}</b> replies captured
        </span>
        <span>
          <b className="tabular-nums">{s?.promoted ?? "…"}</b> in the knowledge base
        </span>
        <span>
          <b className="tabular-nums">{s?.withAiDraft ?? "…"}</b> started from an AI draft,{" "}
          <b className="tabular-nums">{s?.aiDraftEdited ?? "…"}</b> of them edited before sending
        </span>
        <span className="text-xs text-muted-foreground">Approved lessons are masked and added every night at 03:30 UTC.</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            className={cn("rounded-full px-3 py-1 text-xs font-medium", status === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            {label}
            {value === "pending" && s ? ` (${s.pending})` : ""}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && !data.lessons.length && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing here.</p>}
      <div className="space-y-3">
        {data?.lessons.map((l) => (
          <article key={l.id} className="rounded-xl border border-border bg-card p-4 text-sm">
            <header className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{l.ticketId}</span>
              <span>· {l.subject}</span>
              <span>· sent by {l.createdBy}</span>
              {l.aiDraft && (
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5", l.edited ? "bg-warning/12 text-warning" : "bg-success/10 text-success")}>
                  <Sparkles className="size-3" /> {l.edited ? "AI draft, edited" : "AI draft, used as is"}
                </span>
              )}
              {owner && (l.status === "pending" || l.status === "approved" || l.status === "rejected") && (
                <span className="ml-auto flex gap-1">
                  {l.status !== "approved" && (
                    <button type="button" onClick={() => decide(l.id, "approved")} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground">
                      <Check className="size-3.5" /> Approve
                    </button>
                  )}
                  {l.status !== "rejected" && (
                    <button type="button" onClick={() => decide(l.id, "rejected")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium ring-1 ring-border hover:bg-accent">
                      <X className="size-3.5" /> Reject
                    </button>
                  )}
                </span>
              )}
            </header>
            <div className={cn("mt-3 grid gap-3", l.aiDraft ? "md:grid-cols-3" : "md:grid-cols-2")}>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Customer asked</p>
                <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-2.5 text-xs">{l.customerMessage}</p>
              </div>
              {l.aiDraft && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">AI draft</p>
                  <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-2.5 text-xs">{l.aiDraft}</p>
                </div>
              )}
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Sent</p>
                <p className="whitespace-pre-wrap rounded-lg bg-primary/5 p-2.5 text-xs">{l.finalText}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
