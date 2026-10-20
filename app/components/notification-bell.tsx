"use client";

// The bell: this staff member's notifications (customer replies on their tickets, tickets
// assigned to them, urgent tickets), with an unread count.

import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/helpdesk-format";
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
  const load = useCallback(() => apiJson<{ unread: number; items: Item[] }>("/api/notifications").then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 30_000);
    return () => clearInterval(t);
  }, [load]);
  const mark = (body: { ids?: number[]; all?: boolean }) => apiJson<{ unread: number; items: Item[] }>("/api/notifications", jsonInit("POST", body)).then(setData).catch(() => {});
  const open = (item: Item) => {
    if (!item.read) mark({ ids: [item.id] });
    if (!item.ticketId) return;
    if (onOpenTicket) onOpenTicket(item.ticketId);
    else window.location.assign(`/?ticket=${encodeURIComponent(item.ticketId)}`);
  };
  return (
    <Popover
      align={align}
      panelClassName="w-80 p-0"
      trigger={({ toggle, open: isOpen }) => (
        <button
          type="button"
          onClick={() => {
            toggle();
            if (!isOpen) load();
          }}
          aria-label={`Notifications${data.unread ? ` (${data.unread} unread)` : ""}`}
          title="Notifications"
          className="relative inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Bell className="size-4" />
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
            {data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    open(item);
                  }}
                  className={cn("flex w-full gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent", !item.read && "bg-primary/5")}
                >
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", item.read ? "bg-transparent" : item.kind === "urgent" || item.kind === "alert" ? "bg-destructive" : "bg-primary")} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2">{item.text}</span>
                    <span className="text-[11px] text-muted-foreground">{formatRelative(item.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
            {!data.items.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet.</li>}
          </ul>
        </div>
      )}
    </Popover>
  );
}
