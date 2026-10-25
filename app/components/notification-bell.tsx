"use client";

// The bell: this staff member's notifications (customer replies on their tickets, tickets
// assigned to them, urgent tickets), with an unread count.

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/lib/helpdesk-format";
import { groupNotifications } from "@/lib/notification-groups";
import { apiJson, jsonInit } from "./api";
import { Popover } from "./ui";

interface Item {
  id: number;
  kind: string;
  ticketId: string | null;
  text: string;
  createdAt: string;
  read: boolean;
}

export function NotificationBell({ onOpenTicket, align = "left" }: { onOpenTicket?: (id: string) => void; align?: "left" | "right" }) {
  const [data, setData] = useState<{ unread: number; items: Item[] }>({ unread: 0, items: [] });
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const load = useCallback(() => apiJson<{ unread: number; items: Item[] }>("/api/notifications").then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 30_000);
    return () => clearInterval(t);
  }, [load]);
  const mark = (body: { ids?: number[]; all?: boolean }) => apiJson<{ unread: number; items: Item[] }>("/api/notifications", jsonInit("POST", body)).then(setData).catch(() => {});
  const open = (group: ReturnType<typeof groupNotifications>[number]) => {
    if (group.unread) mark({ ids: group.ids });
    if (!group.ticketId) return;
    if (onOpenTicket) onOpenTicket(group.ticketId);
    // A full load: the inbox reads ?ticket= when it mounts
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    else window.location.assign(`/?ticket=${encodeURIComponent(group.ticketId)}`);
  };
  const groups = groupNotifications(data.items);
  return (
    <Popover
      align={align}
      panelClassName="w-[min(36rem,calc(100vw-1rem))] p-0"
      trigger={({ toggle, open: isOpen }) => (
        <button
          type="button"
          onClick={() => {
            toggle();
            if (!isOpen) load();
          }}
          aria-label={`Notifications${data.unread ? ` (${data.unread} unread)` : ""}`}
          title="Notifications"
          className="relative inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Bell className="size-4" />
          <span>Notifications</span>
          {data.unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-white">
              {data.unread > 99 ? "99+" : data.unread}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {data.unread > 0 && (
              <button type="button" onClick={() => mark({ all: true })} className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto p-1">
            {groups.map((group) => (
              <li key={group.key} className="rounded-lg">
                <div className="flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      open(group);
                    }}
                    className={cn("flex min-w-0 flex-1 gap-2 rounded-lg px-2.5 py-2.5 text-left text-sm hover:bg-accent", group.unread && "bg-primary/5")}
                  >
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", !group.unread ? "bg-transparent" : group.kind === "urgent" || group.kind === "alert" ? "bg-destructive" : "bg-primary")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        {group.ticketId && <span className="font-mono text-xs font-semibold text-primary">{group.ticketId}</span>}
                        {group.count > 1 && <span className="text-[11px] text-muted-foreground">{group.count} updates grouped</span>}
                      </span>
                      <span className="mt-0.5 block line-clamp-2">{group.text}</span>
                      <span className="text-[11px] text-muted-foreground" title={formatDateTime(group.createdAt)}>{formatRelative(group.createdAt)}</span>
                    </span>
                  </button>
                  {group.count > 1 && (
                    <button
                      type="button"
                      aria-expanded={expandedGroups.has(group.key)}
                      aria-label={(expandedGroups.has(group.key) ? "Hide " : "Show ") + group.count + " updates for " + (group.ticketId ?? "notification")}
                      onClick={() => setExpandedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })}
                      className="mt-1 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      {expandedGroups.has(group.key) ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </button>
                  )}
                </div>
                {expandedGroups.has(group.key) && (
                  <ul className="ml-5 space-y-1 border-l border-border py-1 pl-3">
                    {group.items.map((item) => (
                      <li key={item.id} className="text-xs">
                        <span className="font-medium capitalize">{item.kind}</span>
                        <span className="text-muted-foreground"> · {item.text}</span>
                        <span className="block text-[11px] text-muted-foreground" title={formatDateTime(item.createdAt)}>{formatRelative(item.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {!data.items.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet.</li>}
          </ul>
        </div>
      )}
    </Popover>
  );
}
