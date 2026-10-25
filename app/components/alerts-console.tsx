"use client";

// Alerts page: owner alert emails (urgent tickets, worker stopped/recovered), with their
// delivery status and retry, plus a test alert.

import { useCallback, useEffect, useState } from "react";
import { Send, RotateCcw, ChevronLeft, ChevronRight, MailWarning, CheckCircle2, Clock, XCircle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/helpdesk-format";
import type { AlertRow } from "@/lib/alerts";
import { apiJson, jsonInit } from "./api";
import { useSession } from "./context/session-context";

const STATUS: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  pending: { label: "Waiting to send", icon: Clock, tone: "text-muted-foreground" },
  sending: { label: "Sending", icon: Clock, tone: "text-muted-foreground" },
  sent: { label: "Sent", icon: CheckCircle2, tone: "text-success" },
  failed: { label: "Failed", icon: XCircle, tone: "text-destructive" },
  skipped: { label: "Not emailed", icon: MinusCircle, tone: "text-warning" },
};

function alertStatus(alert: AlertRow, now: number) {
  const rateLimited = alert.lastError?.startsWith("Rate limit:") ?? false;
  const waitingForLimit = rateLimited && !!alert.nextAttemptAt && Date.parse(alert.nextAttemptAt) > now;
  const status = rateLimited
    ? {
        ...STATUS[alert.status === "pending" ? "pending" : "skipped"],
        label: alert.status === "pending" ? "Queued after rate limit" : waitingForLimit ? "Rate limited" : "Ready to retry",
      }
    : alert.status === "skipped" && alert.lastError?.startsWith("No ALERT_EMAIL")
      ? { ...STATUS.skipped, label: "In-app only" }
      : STATUS[alert.status] ?? STATUS.pending;
  return { rateLimited, waitingForLimit, status };
}

function AlertStatusContent({ alert, now }: { alert: AlertRow; now: number }) {
  const { rateLimited, waitingForLimit, status } = alertStatus(alert, now);
  return (
    <>
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium", status.tone)}>
        <status.icon className="size-3.5" />
        {status.label}
      </span>
      {rateLimited ? (
        <p className="mt-0.5 max-w-xs break-words text-[11px] text-muted-foreground">
          Emails are capped at 30 per hour to avoid a flood. {waitingForLimit ? `Try again after ${formatDateTime(alert.nextAttemptAt!)}.` : "The cap has cleared; you can retry now."} The system checks the cap again before sending.
        </p>
      ) : alert.status === "pending" && alert.nextAttemptAt ? (
        <p className="mt-0.5 max-w-xs break-words text-[11px] text-muted-foreground">Next automatic attempt: {formatDateTime(alert.nextAttemptAt)}.</p>
      ) : alert.lastError ? (
        <p className="mt-0.5 max-w-xs break-words text-[11px] text-muted-foreground">{alert.lastError}</p>
      ) : null}
      {alert.attempts > 1 && <p className="text-[11px] text-muted-foreground">{alert.attempts} attempts</p>}
    </>
  );
}

export function AlertsConsole() {
  const { user } = useSession();
  const owner = user?.role === "owner";
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ alerts: AlertRow[]; total: number; recipients: number } | null>(null);
  const [now, setNow] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiJson<{ alerts: AlertRow[]; total: number; recipients: number }>(`/api/alerts?offset=${offset}`)
        .then((result) => {
          setData(result);
          setNow(Date.now());
        })
        .catch((e) => setMessage(e.message)),
    [offset],
  );
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) {
        setNow(Date.now());
        load();
      }
    }, 15_000);
    return () => clearInterval(t);
  }, [load]);
  const act = async (url: string, done: string) => {
    try {
      const result = await apiJson<{ rateLimited?: boolean; nextAttemptAt?: string | null }>(url, jsonInit("POST"));
      setMessage(
        result.rateLimited && result.nextAttemptAt
          ? `Queued for ${formatDateTime(result.nextAttemptAt)}. The 30-per-hour email cap stays in effect, and the alert will be checked again before sending.`
          : done,
      );
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "That didn't work");
    }
  };

  return (
      <div className="mx-auto w-full min-w-0 max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex w-full min-w-0 flex-wrap items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm sm:items-center">
        <MailWarning className="size-5 text-primary" />
        <div className="min-w-[14rem] flex-1">
          <p className="font-medium">Owner alerts</p>
          <p className="text-xs text-muted-foreground">
            Critical and high-priority tickets, and the AI worker stopping or recovering, are emailed once each.{" "}
            {data && (data.recipients ? `${data.recipients} address${data.recipients === 1 ? "" : "es"} set (ALERT_EMAIL).` : "No alert address is set (ALERT_EMAIL), so alerts stay in-app.")}
          </p>
        </div>
        {owner && (
          <button type="button" onClick={() => act("/api/alerts/test", "Test alert queued: it goes out within a minute")} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium ring-1 ring-border hover:bg-accent sm:ml-auto sm:h-8 sm:w-auto">
            <Send className="size-3.5" /> Send a test alert
          </button>
        )}
      </div>
      {message && data && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
      {!data && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {message ? `Could not load alerts: ${message}` : "Loading alerts…"}
          {message && <button type="button" onClick={load} className="rounded-md px-2 py-1 text-primary ring-1 ring-border hover:bg-accent">Try again</button>}
        </div>
      )}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card sm:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Alert</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data?.alerts.map((a) => {
              return (
                <tr key={a.id} className="border-t border-border align-top">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{a.subject.replace(/^\[Helpdesk\]\s*/, "")}</p>
                    {a.ticketId && (
                      <a href={`/?ticket=${encodeURIComponent(a.ticketId)}`} className="text-xs text-primary hover:underline">
                        Open {a.ticketId}
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <AlertStatusContent alert={a} now={now} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(a.sentAt ?? a.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {owner && (a.status === "failed" || a.status === "skipped") && (
                      <button type="button" onClick={() => act(`/api/alerts/${a.id}/retry`, "Queued to send again")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-border hover:bg-accent">
                        <RotateCcw className="size-3.5" /> Retry
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {data && !data.alerts.length && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No alerts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {data && data.total > 25 && (
          <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {offset + 1}–{Math.min(offset + 25, data.total)} of {data.total}
            <button type="button" aria-label="Newer" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))} className="ml-auto rounded p-1 hover:bg-accent disabled:opacity-30">
              <ChevronLeft className="size-4" />
            </button>
            <button type="button" aria-label="Older" disabled={offset + 25 >= data.total} onClick={() => setOffset(offset + 25)} className="rounded p-1 hover:bg-accent disabled:opacity-30">
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
      <div role="region" aria-label="Owner alert list" className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:hidden">
        {data?.alerts.map((a) => (
          <article key={a.id} className="min-w-0 p-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{a.subject.replace(/^\[Helpdesk\]\s*/, "")}</p>
                {a.ticketId && (
                  <a href={`/?ticket=${encodeURIComponent(a.ticketId)}`} className="text-xs text-primary hover:underline">
                    Open {a.ticketId}
                  </a>
                )}
              </div>
              {owner && (a.status === "failed" || a.status === "skipped") && (
                <button type="button" onClick={() => act(`/api/alerts/${a.id}/retry`, "Queued to send again")} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-3 text-xs font-medium ring-1 ring-border hover:bg-accent">
                  <RotateCcw className="size-3.5" /> Retry
                </button>
              )}
            </div>
            <div className="mt-3 min-w-0">
              <AlertStatusContent alert={a} now={now} />
            </div>
            <time className="mt-2 block text-xs text-muted-foreground" title={formatDateTime(a.sentAt ?? a.createdAt)}>
              {formatDateTime(a.sentAt ?? a.createdAt)}
            </time>
          </article>
        ))}
        {data && !data.alerts.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No alerts yet.</p>}
        {data && data.total > 25 && (
          <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
            {offset + 1}–{Math.min(offset + 25, data.total)} of {data.total}
            <button type="button" aria-label="Newer" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))} className="ml-auto min-h-9 rounded p-2 hover:bg-accent disabled:opacity-30">
              <ChevronLeft className="size-4" />
            </button>
            <button type="button" aria-label="Older" disabled={offset + 25 >= data.total} onClick={() => setOffset(offset + 25)} className="min-h-9 rounded p-2 hover:bg-accent disabled:opacity-30">
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
