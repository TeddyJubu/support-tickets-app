"use client";

// Overview: escalations, workload, AI drafting, recent staff activity, learning and system
// health. A part that fails to load says "unavailable" rather than showing zeros.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Flag, Sparkles, Activity, GraduationCap, Server, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/lib/helpdesk-format";
import type { overview } from "@/lib/overview";
import { apiJson } from "./api";
import { PRIORITY_META } from "./ui";

type Data = ReturnType<typeof overview>;
type Part<T> = { ok: true; data: T } | { ok: false; error: string };

function Card({ title, icon: Icon, children, className }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("w-full min-w-0 rounded-xl border border-border bg-card p-4", className)}>
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
  draft_ready: "prepared an AI draft on",
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
  send_access_on: "enabled sending",
  send_access_off: "disabled sending",
  alert_retry: "retried an owner alert",
  alert_test: "queued a test alert",
  shopify_connect: "connected the Shopify store",
  shopify_disconnect: "disconnected the Shopify store",
  lesson_approved: "approved a reply lesson",
  lesson_rejected: "rejected a reply lesson",
};

const HEALTH_LABEL: Record<string, string> = {
  webService: "Website",
  worker: "AI worker",
  database: "Database",
  draftQueue: "AI draft queue (worker snapshot)",
  disk: "Disk space",
  backups: "Latest backup",
  offsiteBackups: "Off-site backup copy",
  knowledgeBase: "Knowledge base",
  alerts: "Alert emails",
};

function healthNextStep(name: string, detail: string): string | null {
  if (name === "backups") {
    if (/certificate/i.test(detail)) return "Set up encrypted backups with npm run helpdesk -- backup-setup, then keep the private key off this server.";
    if (/no backup/i.test(detail)) return "Create an encrypted backup with npm run helpdesk -- backup.";
    return "Check npm run helpdesk -- worker, then run npm run helpdesk -- backup after fixing the reported cause.";
  }
  if (name === "offsiteBackups") {
    if (/local only/i.test(detail)) return "Set up an encrypted off-site bucket so a server failure cannot take both copies. Check npm run helpdesk -- backups after setup.";
    return "Check the bucket settings and npm run helpdesk -- backups; the local encrypted backup is still available.";
  }
  if (name === "worker" || name === "draftQueue") return "Check npm run helpdesk -- worker for its heartbeat and draft queue.";
  if (name === "webService") return "Check npm run helpdesk -- status and npm run helpdesk -- logs 100.";
  if (name === "database") return "Check npm run helpdesk -- status and the helpdesk service logs.";
  if (name === "disk") return "Review free space with df -h before making room.";
  if (name === "knowledgeBase") return "Open the knowledge base to inspect its index and product articles.";
  if (name === "alerts") return "Open Alerts to review failed email deliveries and retry them.";
  return null;
}

function healthSummary(name: string, detail: string) {
  if (name === "offsiteBackups" && /local only/i.test(detail)) return "Backups are stored only on this server.";
  if (name === "backups" && /no backup/i.test(detail)) return "No encrypted backup has been created yet.";
  if (name === "backups" && /last run failed/i.test(detail)) return "The latest scheduled backup failed.";
  if (name === "backups") {
    const latest = detail.match(/latest ([^;]+)/i)?.[1];
    if (latest) return `Newest encrypted backup: ${latest}.`;
  }
  if (name === "offsiteBackups" && /upload failed/i.test(detail)) return "The newest encrypted backup has not reached the off-site bucket.";
  return detail;
}

function showTechnicalDetails(name: string) {
  return name === "backups" || name === "offsiteBackups";
}

function actionLabel(action: string) {
  return ACTION[action] ?? action.replace(/_/g, " ");
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

export function OverviewConsole() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiJson<Data>("/api/overview")
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 30_000);
    return () => clearInterval(t);
  }, [load]);
  if (error && !data) return <p className="p-6 text-sm text-destructive">Overview unavailable: {error}</p>;
  const d = data;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-7xl grid-cols-1 gap-4 p-4 md:grid-cols-2 md:p-6 xl:grid-cols-3">
      {error && (
        // Old numbers stay on screen, so say they may be out of date
        <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning md:col-span-2 xl:col-span-3">
          Couldn&apos;t refresh ({error}): showing the last numbers loaded. Retrying every 30 seconds.
        </p>
      )}
      <Card title="Needs attention" icon={Flag} className="xl:col-span-2">
        <Show part={d?.escalations}>
          {(rows) =>
            rows.length ? (
              <ul className="min-w-0 divide-y divide-border">
                {rows.map((t) => (
                  <li key={t.id} className="min-w-0">
                    <a href={`/?ticket=${encodeURIComponent(t.id)}`} className="block min-w-0 py-2 text-sm hover:bg-accent/50">
                      <span className="flex items-center gap-3">
                        <span className={cn("w-16 shrink-0 text-xs font-semibold", PRIORITY_META[t.priority]?.tone)}>{PRIORITY_META[t.priority]?.label}</span>
                        <span className="min-w-0 flex-1 truncate">{t.subject ?? "(no subject)"}</span>
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{t.assignee ?? "unassigned"}</span>
                        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground" title={formatDateTime(t.updatedAt)}>{formatRelative(t.updatedAt)}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{t.id}</span>
                      </span>
                      {t.priorityReason && <span className="mt-1 block pl-[4.75rem] text-xs text-muted-foreground">Priority increased because {t.priorityReason}</span>}
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
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>No monitor report yet. The worker writes one every minute.</p>
                <p className="text-xs">Next: check npm run helpdesk -- worker if a report does not appear.</p>
              </div>
            ) : (
              <>
                {ops.state === "stale" && (
                  <p className="mb-2 flex items-center gap-1.5 text-xs text-warning">
                    <AlertTriangle className="size-3.5" /> Report is {Math.round((ops.ageSeconds ?? 0) / 60)} min old: the worker may be stopped. Check npm run helpdesk -- worker.
                  </p>
                )}
                <ul className="min-w-0 space-y-1.5 text-sm">
                  {Object.entries(ops.status.checks).map(([name, c]) => (
                    <li key={name} className="flex items-start gap-2">
                      {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{HEALTH_LABEL[name] ?? name.replace(/([A-Z])/g, " $1").toLowerCase()}</p>
                        <p className="text-xs text-muted-foreground">{healthSummary(name, c.detail)}</p>
                        {!c.ok && healthNextStep(name, c.detail) && <p className="mt-0.5 text-xs text-warning">Next: {healthNextStep(name, c.detail)}</p>}
                        {!c.ok && showTechnicalDetails(name) && (
                          <details className="mt-1 text-xs">
                            <summary className="cursor-pointer text-muted-foreground">Technical details</summary>
                            <p className="mt-1 break-words text-muted-foreground">{c.detail}</p>
                          </details>
                        )}
                        {!c.ok && name === "knowledgeBase" && <a href="/kb" className="mt-0.5 inline-block text-xs text-primary hover:underline">Open knowledge base</a>}
                        {!c.ok && name === "alerts" && <a href="/alerts" className="mt-0.5 inline-block text-xs text-primary hover:underline">Open alert log</a>}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground" title={formatDateTime(ops.status.at)}>Checked {formatRelative(ops.status.at)}. Shows what the monitor saw; it doesn&apos;t confirm emails were delivered.</p>
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
              <Stat label="Waiting for the draft worker" value={ai.queue.pending ?? 0} />
              <Stat label="Retrying after an error" value={ai.queue.retry_wait ?? 0} />
              <Stat label="Drafts that failed" value={ai.queue.failed ?? 0} tone={Number(ai.queue.failed ?? 0) ? "text-destructive" : undefined} />
              <p className="col-span-2 mt-1 text-[11px] text-muted-foreground" title={formatDateTime(ai.queueCheckedAt)}>
                Queue counts checked {formatRelative(ai.queueCheckedAt)}. System health shows the worker&apos;s last queue snapshot.
              </p>
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
              <ul className="grid min-w-0 gap-x-6 gap-y-1 text-sm md:grid-cols-2">
                {rows.map((a, i) => (
                  <li key={i} className="flex min-w-0 gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">{formatRelative(a.at)}</span>
                    <span className="min-w-0 truncate">
                      <b className="font-medium">{a.actor}</b> {actionLabel(a.action)}{" "}
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
