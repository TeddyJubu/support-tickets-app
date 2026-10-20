"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/helpdesk-format";
import type { TicketStatus } from "./types";

// Small shared building blocks for the helpdesk layout

const AVATAR_HUES = [277, 245, 200, 155, 95, 65, 25, 340, 305];

function hueFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const label = name?.trim() || "?";
  const hue = hueFor(label);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        "bg-[oklch(0.92_0.05_var(--hue))] text-[oklch(0.4_0.12_var(--hue))]",
        "dark:bg-[oklch(0.34_0.07_var(--hue))] dark:text-[oklch(0.9_0.06_var(--hue))]",
        size === "sm" && "size-7 text-[11px]",
        size === "md" && "size-9 text-xs",
        size === "lg" && "size-12 text-sm",
        className,
      )}
      style={{ "--hue": hue } as React.CSSProperties}
    >
      {initials(label)}
    </span>
  );
}

export const STATUS_META: Record<
  TicketStatus,
  { label: string; hint: string; dot: string; pill: string }
> = {
  open: {
    label: "Needs reply",
    hint: "Waiting on you",
    dot: "bg-info",
    pill: "bg-info/12 text-info ring-info/25",
  },
  pending: {
    label: "Waiting",
    hint: "Waiting on the customer",
    dot: "bg-warning",
    pill: "bg-warning/12 text-warning ring-warning/30",
  },
  resolved: {
    label: "Resolved",
    hint: "Resolved",
    dot: "bg-success",
    pill: "bg-success/12 text-success ring-success/25",
  },
  closed: {
    label: "Closed",
    hint: "Closed",
    dot: "bg-muted-foreground/50",
    pill: "bg-muted text-muted-foreground ring-border",
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: TicketStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      title={meta.hint}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        meta.pill,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-sans text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }
>(function IconButton({ label, active, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "bg-accent text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

// Resolves false when the browser blocks clipboard access
export async function copyText(text: string) {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Platform-aware modifier key label
export function modKey() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}

// A button that opens a small floating panel; closes on outside click, Escape, or close()
export function Popover({
  trigger,
  children,
  align = "left",
  className,
  panelClassName,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={cn("relative", className)} ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={cn(
            "absolute top-full z-50 mt-1.5 min-w-52 rounded-xl border border-border bg-popover p-1 shadow-pop animate-in fade-in zoom-in-95 duration-100",
            align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            panelClassName,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon: Icon,
  label,
  hint,
  checked,
  danger,
  disabled,
  onSelect,
  right,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  hint?: React.ReactNode;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  right?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-40",
        danger ? "text-destructive" : "text-popover-foreground",
      )}
    >
      {Icon && <Icon className="mt-0.5 size-4 shrink-0 opacity-80" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      {right}
      {checked && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
    </button>
  );
}

export const MenuDivider = () => <div className="my-1 h-px bg-border" role="separator" />;

export const MenuLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>
);

export const PRIORITY_META: Record<string, { label: string; tone: string }> = {
  critical: { label: "Critical", tone: "text-destructive" },
  high: { label: "High", tone: "text-warning" },
  normal: { label: "Normal", tone: "text-muted-foreground" },
  low: { label: "Low", tone: "text-muted-foreground/70" },
};

/** Snooze presets: later today, tomorrow 9:00, next Monday 9:00, in a week */
export function snoozeOptions(now = new Date()) {
  const at = (d: Date, h: number) => {
    const x = new Date(d);
    x.setHours(h, 0, 0, 0);
    return x;
  };
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const monday = new Date(now);
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  const week = new Date(now);
  week.setDate(now.getDate() + 7);
  const options: Array<{ label: string; until: Date }> = [];
  if (now.getHours() < 15) options.push({ label: "Later today (3 hours)", until: new Date(now.getTime() + 3 * 3600e3) });
  options.push({ label: "Tomorrow morning", until: at(tomorrow, 9) });
  options.push({ label: "Next Monday", until: at(monday, 9) });
  options.push({ label: "In a week", until: at(week, 9) });
  return options;
}
