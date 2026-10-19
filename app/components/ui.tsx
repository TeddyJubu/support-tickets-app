"use client";

import { forwardRef } from "react";
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
