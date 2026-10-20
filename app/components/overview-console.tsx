"use client";

// Overview: escalations, workload, AI drafting, recent staff activity, learning and system
// health. A part that fails to load says "unavailable" rather than showing zeros.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Flag, Sparkles, Activity, GraduationCap, Server, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/helpdesk-format";
import type { overview } from "@/lib/overview";
import { apiJson } from "./api";
import { PRIORITY_META } from "./ui";

type Data = ReturnType<typeof overview>;
type Part<T> = { ok: true; data: T } | { ok: false; error: string };

function Card({ title, icon: Icon, children, className }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-primary" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Show<T>({ part, children }: { part: Part<T> | undefined; children: (data: T) => React.ReactNode }) {
  if (!part) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!part.ok) return <p className="text-sm text-muted-foreground">Unavailable ({part.error})</p>;
  return <>{children(part.data)}</>;
}

const ACTION: Record<string, string> = {
  reply: "replied on",
  note: "added a note on",
  status: "changed the status of",
  triage: "updated",
  login: "signed in",
  draft_used: "used the AI draft on",
  draft_dismissed: "dismissed the AI draft on",
  draft_retry: "asked for a new draft on",
  draft_rewrite: "rewrote a draft on",
  ticket_create: "opened",
  kb_save: "edited a KB article",
  kb_create: "added a KB article",
  kb_reindex: "re-indexed the KB",
  notice_create: "posted a notice",
  notice_end: "ended a notice",
  send_resolved: "settled a send on",
  send_access_on: "turned on Read & write",
};

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

export function OverviewConsole() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => apiJson<Data>("/api/overview").then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 30_000);
    return () => clearInterval(t);
  }, [load]);
  if (error && !data) return <p className="p-6 text-sm text-destructive">Overview unavailable: {error}</p>;
  const d = data;

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 md:grid-cols-2 md:p-6 xl:grid-cols-3">
      <Card title="Needs attention" icon={Flag} className="xl:col-span-2">
        <Show part={d?.escalations}>
          {(rows) =>
            rows.length ? (
              <ul className="divide-y divide-border">
                {rows.map((t) => (
                  <li key={t.id}>
                    <a href={`/?ticket=${encodeURIComponent(t.id)}`} className="flex items-center gap-3 py-2 text-sm hover:bg-accent/50">
                      <span className={cn("w-16 shrink-0 text-xs font-semibold", PRIORITY_META[t.priority]?.tone)}>{PRIORITY_META[t.priority]?.label}</span>
                      <span className="min-w-0 flex-1 truncate">{t.subject ?? "(no subject)"}</span>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{t.assignee ?? "unassigned"}</span>
                      <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{formatRelative(t.updatedAt)}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{t.id}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-success" /> No open critical or high-priority tickets.
              </p>
            )
          }
        </Show>
      </Card>

      <Card title="System health" icon={Server}>
        <Show part={d?.ops}>
          {(ops) =>
            ops.state === "missing" || !ops.status ? (
              <p className="text-sm text-muted-foreground">No monitor report yet: the worker writes one every minute once it runs.</p>
            ) : (
              <>
                {ops.state === "stale" && (
                  <p className="mb-2 flex items-center gap-1.5 text-xs text-warning">
                    <AlertTriangle className="size-3.5" /> Report is {Math.round((ops.ageSeconds ?? 0) / 60)} min old: the worker may be stopped.
                  </p>
                )}
                <ul className="space-y-1.5 text-sm">
                  {Object.entries(ops.status.checks).map(([name, c]) => (
                    <li key={name} className="flex items-start gap-2">
                      {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                      <span className="w-28 shrink-0 capitalize">{name.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                      <span className="min-w-0 text-xs text-muted-foreground">{c.detail}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">Checked {formatRelative(ops.status.at)}. Shows what the monitor saw; it doesn&apos;t confirm emails were delivered.</p>
              </>
            )
          }
        </Show>
      </Card>

      <Card title="Workload" icon={Users}>
        <Show part={d?.workload}>
          {(w) => (
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Needs reply" value={w.byStatus.open ?? 0} />
              <Stat label="Waiting on customer" value={w.byStatus.pending ?? 0} />
              <Stat label="Unassigned (open)" value={w.unassigned} />
              <Stat label="Critical + high (open)" value={(w.openByPriority.critical ?? 0) + (w.openByPriority.high ?? 0)} tone="text-destructive" />
            </div>
          )}
        </Show>
      </Card>

      <Card title="AI drafts (last 24 h)" icon={Sparkles}>
        <Show part={d?.ai}>
          {(ai) => (
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Drafted" value={ai.last24h.created} />
              <Stat label="Used by staff" value={ai.last24h.used} />
              <Stat label="Needed staff input" value={ai.last24h.needsStaff} />
              <Stat label="Waiting / failed now" value={`${Number(ai.queue.pending ?? 0) + Number(ai.queue.retry_wait ?? 0)} / ${ai.queue.failed ?? 0}`} />
            </div>
          )}
        </Show>
      </Card>

      <Card title="Learning" icon={GraduationCap}>
        <Show part={d?.learning}>
          {(l) => (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Replies captured" value={l.total} />
                <Stat label="Waiting for review" value={l.pending} />
                <Stat label="In the knowledge base" value={l.promoted} />
                <Stat label="AI drafts edited" value={l.withAiDraft ? `${Math.round((l.aiDraftEdited / l.withAiDraft) * 100)}%` : "—"} />
              </div>
              <a href="/kb" className="mt-2 inline-block text-xs text-primary hover:underline">
                Review lessons
              </a>
            </>
          )}
        </Show>
      </Card>

      <Card title="Recent activity" icon={Activity} className="md:col-span-2 xl:col-span-3">
        <Show part={d?.activity}>
          {(rows) =>
            rows.length ? (
              <ul className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
                {rows.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">{formatRelative(a.at)}</span>
                    <span className="min-w-0 truncate">
                      <b className="font-medium">{a.actor}</b> {ACTION[a.action] ?? a.action}{" "}
                      {a.ticketId && (
                        <a href={`/?ticket=${encodeURIComponent(a.ticketId)}`} className="font-mono text-xs text-primary hover:underline">
                          {a.ticketId}
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )
          }
        </Show>
      </Card>
    </div>
  );
}
