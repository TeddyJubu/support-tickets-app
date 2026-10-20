"use client";

// Alerts page: owner alert emails (urgent tickets, worker stopped/recovered), with their
// delivery status and retry, plus a test alert.

import { useCallback, useEffect, useState } from "react";
import { Send, RotateCcw, ChevronLeft, ChevronRight, MailWarning, CheckCircle2, Clock, XCircle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
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

export function AlertsConsole() {
  const { user } = useSession();
  const owner = user?.role === "owner";
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ alerts: AlertRow[]; total: number; recipients: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(
    () => apiJson<{ alerts: AlertRow[]; total: number; recipients: number }>(`/api/alerts?offset=${offset}`).then(setData).catch((e) => setMessage(e.message)),
    [offset],
  );
  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 15_000);
    return () => clearInterval(t);
  }, [load]);
  const act = async (url: string, done: string) => {
    try {
      await apiJson(url, jsonInit("POST"));
      setMessage(done);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "That didn't work");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <MailWarning className="size-5 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Owner alerts</p>
          <p className="text-xs text-muted-foreground">
            Critical and high-priority tickets, and the AI worker stopping or recovering, are emailed once each.{" "}
            {data && (data.recipients ? `${data.recipients} address${data.recipients === 1 ? "" : "es"} set (ALERT_EMAIL).` : "No alert address is set (ALERT_EMAIL), so alerts stay in-app.")}
          </p>
        </div>
        {owner && (
          <button type="button" onClick={() => act("/api/alerts/test", "Test alert queued: it goes out within a minute")} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium ring-1 ring-border hover:bg-accent">
            <Send className="size-3.5" /> Send a test alert
          </button>
        )}
      </div>
      {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
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
              const st = STATUS[a.status] ?? STATUS.pending;
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
                    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", st.tone)}>
                      <st.icon className="size-3.5" />
                      {st.label}
                    </span>
                    {a.lastError && <p className="mt-0.5 max-w-xs text-[11px] text-muted-foreground">{a.lastError}</p>}
                    {a.attempts > 1 && <p className="text-[11px] text-muted-foreground">{a.attempts} attempts</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">{new Date(a.sentAt ?? a.createdAt).toLocaleString()}</td>
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
    </div>
  );
}
