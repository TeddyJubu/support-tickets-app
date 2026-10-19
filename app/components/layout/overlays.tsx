"use client";

import { useEffect } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboard } from "../context/dashboard-context";
import { IconButton, Kbd, modKey } from "../ui";

export function Toaster() {
  const { toasts, dismissToast } = useDashboard();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((t) => {
        const Icon = t.tone === "error" ? AlertCircle : t.tone === "info" ? Info : CheckCircle2;
        return (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border border-border bg-popover px-3.5 py-3 text-sm text-popover-foreground shadow-pop animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <Icon
              className={cn(
                "mt-px size-4 shrink-0",
                t.tone === "error" ? "text-destructive" : t.tone === "info" ? "text-info" : "text-success",
              )}
            />
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismissToast(t.id)}
              className="-mr-1 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

// Single-key shortcuts for moving through the inbox
export function useHotkeys(onShowShortcuts: () => void) {
  const { selectAdjacentTicket, setTicketStatus, ticketStatus, ticketDetail } = useDashboard();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      switch (e.key) {
        case "j":
          selectAdjacentTicket(1);
          break;
        case "k":
          selectAdjacentTicket(-1);
          break;
        case "/":
          document.getElementById("ticket-search")?.focus();
          break;
        case "r":
          document.getElementById("reply-box")?.focus();
          break;
        case "e":
          if (!ticketDetail?.ticket.simulated || ticketStatus === "closed") return;
          setTicketStatus("closed");
          break;
        case "?":
          onShowShortcuts();
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectAdjacentTicket, setTicketStatus, ticketStatus, ticketDetail, onShowShortcuts]);
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const mod = modKey();
  const groups: Array<[string, Array<[string[], string]>]> = [
    [
      "Inbox",
      [
        [["J"], "Next ticket"],
        [["K"], "Previous ticket"],
        [["/"], "Search tickets"],
        [["E"], "Close ticket"],
      ],
    ],
    [
      "Replying",
      [
        [["R"], "Focus the reply box"],
        [[mod, "↵"], "Send reply"],
        [[mod, "⇧", "↵"], "Send and close"],
        [["Esc"], "Leave the reply box"],
      ],
    ],
    [
      "General",
      [
        [[mod, "J"], "Toggle dark mode"],
        [["?"], "Show this list"],
      ],
    ],
  ];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px] animate-in fade-in duration-150"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border bg-popover p-5 text-popover-foreground shadow-pop animate-in zoom-in-95 duration-150"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-base font-semibold">
            Keyboard shortcuts
          </h2>
          <IconButton label="Close" onClick={onClose} autoFocus>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="space-y-4">
          {groups.map(([title, items]) => (
            <div key={title}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {title}
              </h3>
              <ul className="divide-y divide-border rounded-lg ring-1 ring-border">
                {items.map(([keys, label]) => (
                  <li key={label} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{label}</span>
                    <span className="flex gap-1">
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
