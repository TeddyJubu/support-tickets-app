"use client";

// Inbox list controls: view picker, filters, bulk actions, paging and the new-ticket dialog.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Inbox,
  CircleDot,
  Clock,
  CheckCircle2,
  UserRound,
  UserX,
  AlarmClock,
  Trash2,
  ShieldAlert,
  Flag,
  Mail,
  MailOpen,
  RotateCcw,
  X,
  Plus,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { INBOX_VIEWS, PRIORITIES, type InboxView } from "@/lib/helpdesk-types";
import { useDashboard, PAGE_SIZE } from "../context/dashboard-context";
import { useSession } from "../context/session-context";
import { apiJson } from "../api";
import { MenuDivider, MenuItem, MenuLabel, Popover, PRIORITY_META, snoozeOptions } from "../ui";

export const VIEW_META: Record<InboxView, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  all: { label: "All", icon: Inbox },
  open: { label: "Needs reply", icon: CircleDot },
  pending: { label: "Waiting", icon: Clock },
  mine: { label: "Assigned to me", icon: UserRound },
  unassigned: { label: "Unassigned", icon: UserX },
  snoozed: { label: "Snoozed", icon: AlarmClock },
  closed: { label: "Closed", icon: CheckCircle2 },
  trash: { label: "Trash", icon: Trash2 },
  spam: { label: "Spam", icon: ShieldAlert },
};

export function ViewPicker() {
  const { view, setView, viewCounts } = useDashboard();
  const Current = VIEW_META[view].icon;
  return (
    <Popover
      className="min-w-0 flex-1"
      panelClassName="w-60"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Current className="size-4 text-muted-foreground" />
          <span className="truncate">{VIEW_META[view].label}</span>
          <span className="tabular-nums text-xs text-muted-foreground">{viewCounts[view] ?? ""}</span>
          <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
        </button>
      )}
    >
      {(close) =>
        INBOX_VIEWS.map((v, i) => (
          <div key={v}>
            {(v === "closed" || v === "trash") && i > 0 && <MenuDivider />}
            <MenuItem
              icon={VIEW_META[v].icon}
              label={VIEW_META[v].label}
              checked={view === v}
              right={<span className="mt-0.5 text-xs tabular-nums text-muted-foreground">{viewCounts[v] ?? 0}</span>}
              onSelect={() => {
                close();
                if (v !== view) setView(v);
              }}
            />
          </div>
        ))
      }
    </Popover>
  );
}

const CHANNELS: Array<[string, string]> = [
  ["", "Any channel"],
  ["email", "Real email"],
  ["simulator", "Simulator"],
];

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block px-2.5 py-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-ring"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterMenu() {
  const { filters, setFilters } = useDashboard();
  const { staff } = useSession();
  const [tags, setTags] = useState<Array<{ tag: string; count: number }> | null>(null);
  const [open, setOpen] = useState(false);
  const active = ["priority", "assignee", "tag", "channel"].filter((k) => filters[k as keyof typeof filters]).length +
    (filters.sort !== "newest" ? 1 : 0);
  return (
    <div className="px-3 py-1">
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            if (!tags) apiJson<{ tags: Array<{ tag: string; count: number }> }>("/api/helpdesk/tags").then((d) => setTags(d.tags)).catch(() => setTags([]));
          }}
          aria-expanded={open}
          aria-controls="inbox-filters"
          title="Filter and sort"
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium hover:bg-sidebar-accent",
            active ? "text-primary" : "text-muted-foreground",
          )}
        >
          <SlidersHorizontal className="size-4" />
          Filters &amp; sort
          {active > 0 && <span className="tabular-nums">{active}</span>}
        </button>
      {open && (
        <div id="inbox-filters" className="mt-1 grid max-h-60 grid-cols-2 overflow-y-auto rounded-lg border border-border bg-muted/30 py-1">
          <Select
            label="Priority"
            value={filters.priority}
            onChange={(priority) => setFilters({ priority })}
            options={[["", "Any priority"], ...PRIORITIES.map((p): [string, string] => [p, PRIORITY_META[p].label])]}
          />
          <Select
            label="Assignee"
            value={filters.assignee}
            onChange={(assignee) => setFilters({ assignee })}
            options={[["", "Anyone"], ["none", "Unassigned"], ...staff.map((s): [string, string] => [String(s.id), s.displayName])]}
          />
          <Select
            label="Tag"
            value={filters.tag}
            onChange={(tag) => setFilters({ tag })}
            options={[["", tags ? "Any tag" : "Loading tags…"], ...(tags ?? []).map((t): [string, string] => [t.tag, `${t.tag} (${t.count})`])]}
          />
          <Select label="Channel" value={filters.channel} onChange={(channel) => setFilters({ channel })} options={CHANNELS} />
          <Select
            label="Sort"
            value={filters.sort}
            onChange={(sort) => setFilters({ sort: sort === "oldest" ? "oldest" : "newest" })}
            options={[
              ["newest", "Newest activity first"],
              ["oldest", "Oldest activity first"],
            ]}
          />
          {active > 0 && (
            <>
              <button type="button" className="col-span-2 px-3 py-2 text-left text-xs font-medium text-primary hover:bg-accent" onClick={() => setFilters(null)}>Clear filters</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BulkMenu({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: (close: () => void) => React.ReactNode;
}) {
  return (
    <Popover
      panelClassName="w-52"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          title={label}
          aria-label={label}
          className="inline-flex size-7 items-center justify-center rounded-md text-primary-foreground/90 hover:bg-primary-foreground/15"
        >
          <Icon className="size-4" />
        </button>
      )}
    >
      {children}
    </Popover>
  );
}

export function BulkBar() {
  const { bulkSelection, setBulkAll, applyBulk, view } = useDashboard();
  const { staff } = useSession();
  const count = bulkSelection.size;
  if (!count) return null;
  const run = (changes: Record<string, unknown>, label: string, close?: () => void) => {
    close?.();
    applyBulk(changes, label);
  };
  return (
    <div className="mx-2 mb-1 flex items-center gap-0.5 rounded-lg bg-primary px-2 py-1 text-primary-foreground shadow-soft" role="toolbar" aria-label="Bulk actions">
      <span className="mr-auto text-xs font-medium tabular-nums">{count} selected</span>
      <BulkMenu label="Set status" icon={CheckCircle2}>
        {(close) => (
          <>
            <MenuItem icon={CircleDot} label="Needs reply" onSelect={() => run({ status: "open" }, "Reopened", close)} />
            <MenuItem icon={Clock} label="Waiting" onSelect={() => run({ status: "pending" }, "Marked waiting", close)} />
            <MenuItem icon={CheckCircle2} label="Closed" onSelect={() => run({ status: "closed" }, "Closed", close)} />
          </>
        )}
      </BulkMenu>
      <BulkMenu label="Set priority" icon={Flag}>
        {(close) =>
          PRIORITIES.map((p) => (
            <MenuItem key={p} label={PRIORITY_META[p].label} onSelect={() => run({ priority: p }, `Priority ${p}`, close)} />
          ))
        }
      </BulkMenu>
      <BulkMenu label="Assign" icon={UserRound}>
        {(close) => (
          <>
            {staff.map((s) => (
              <MenuItem key={s.id} label={s.displayName} onSelect={() => run({ assigneeId: s.id }, `Assigned to ${s.displayName}`, close)} />
            ))}
            <MenuDivider />
            <MenuItem icon={UserX} label="Unassign" onSelect={() => run({ assigneeId: null }, "Unassigned", close)} />
          </>
        )}
      </BulkMenu>
      <BulkMenu label="More" icon={ChevronDown}>
        {(close) => (
          <>
            <MenuItem icon={MailOpen} label="Mark read" onSelect={() => run({ read: true }, "Marked read", close)} />
            <MenuItem icon={Mail} label="Mark unread" onSelect={() => run({ read: false }, "Marked unread", close)} />
            <MenuDivider />
            <MenuLabel>Snooze</MenuLabel>
            {snoozeOptions().map((o) => (
              <MenuItem key={o.label} icon={AlarmClock} label={o.label} onSelect={() => run({ snoozedUntil: o.until.toISOString() }, "Snoozed", close)} />
            ))}
            {view === "snoozed" && <MenuItem icon={RotateCcw} label="Wake now" onSelect={() => run({ snoozedUntil: null }, "Woken", close)} />}
            <MenuDivider />
            {view === "trash" ? (
              <MenuItem icon={RotateCcw} label="Restore from trash" onSelect={() => run({ trashed: false }, "Restored", close)} />
            ) : (
              <MenuItem icon={Trash2} danger label="Move to trash" onSelect={() => run({ trashed: true }, "Moved to trash", close)} />
            )}
            {view === "spam" ? (
              <MenuItem icon={RotateCcw} label="Not spam" onSelect={() => run({ spam: false }, "Marked not spam", close)} />
            ) : (
              <MenuItem icon={ShieldAlert} label="Mark as spam" onSelect={() => run({ spam: true }, "Marked spam", close)} />
            )}
          </>
        )}
      </BulkMenu>
      <button
        type="button"
        onClick={() => setBulkAll(false)}
        aria-label="Clear selection"
        title="Clear selection"
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-primary-foreground/15"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Pager() {
  const { page, setPage, hasNextPage, ticketTotal, tickets, ticketsLoading } = useDashboard();
  if (!ticketTotal) return null;
  const from = page * PAGE_SIZE + 1;
  const to = page * PAGE_SIZE + tickets.length;
  const pages = Math.ceil(ticketTotal / PAGE_SIZE);
  return (
    <div className="flex items-center gap-1 border-t border-sidebar-border px-3 py-1.5 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {from.toLocaleString()}–{to.toLocaleString()} of {ticketTotal.toLocaleString()}
      </span>
      {ticketsLoading && <Loader2 className="size-3.5 animate-spin" />}
      <label className="ml-auto inline-flex items-center gap-1">
        Page
        <input key={page} aria-label="Jump to page" type="number" min={1} max={pages} defaultValue={page + 1}
          disabled={ticketsLoading} className="w-14 rounded border border-input bg-background px-1 py-1 text-foreground"
          onKeyDown={(e) => { if (e.key === "Enter") { const value = Number(e.currentTarget.value); if (Number.isInteger(value) && value >= 1 && value <= pages) setPage(value - 1); } }}
          onBlur={(e) => { const value = Number(e.currentTarget.value); if (Number.isInteger(value) && value >= 1 && value <= pages && value !== page + 1) setPage(value - 1); }} />
        <span title={`${pages.toLocaleString()} pages`}>/ {pages.toLocaleString()}</span>
      </label>
      <button
        type="button"
        aria-label="Previous page"
        disabled={page === 0 || ticketsLoading}
        onClick={() => setPage(page - 1)}
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-sidebar-accent disabled:opacity-30"
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Next page"
        disabled={!hasNextPage || ticketsLoading}
        onClick={() => setPage(page + 1)}
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-sidebar-accent disabled:opacity-30"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export function NewTicketButton({ onCreated }: { onCreated?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        title="New ticket"
        aria-label="New ticket"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-soft hover:bg-primary/90"
      >
        <Plus className="size-4" />
      </button>
      {open && <NewTicketDialog onClose={close} onCreated={onCreated} returnFocus={trigger} />}
    </>
  );
}

function NewTicketDialog({ onClose, onCreated, returnFocus }: { onClose: () => void; onCreated?: () => void; returnFocus: { current: HTMLButtonElement | null } }) {
  const { createTicket } = useDashboard();
  const [form, setForm] = useState({ email: "", name: "", subject: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const returnTarget = returnFocus.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const onTrapTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0);
      if (!focusable.length) {
        e.preventDefault();
        dialog.current.focus();
        return;
      }
      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey ? active === firstFocusable || !dialog.current.contains(active) : active === lastFocusable || !dialog.current.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? lastFocusable : firstFocusable).focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onTrapTab);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keydown", onTrapTab);
      const target = previouslyFocused?.isConnected ? previouslyFocused : returnTarget;
      target?.focus();
    };
  }, [onClose, returnFocus]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(form.email.trim())) return setError("Enter the customer's email address");
    if (!form.subject.trim()) return setError("Enter a subject");
    setBusy(true);
    const id = await createTicket(form);
    setBusy(false);
    if (id) {
      onClose();
      onCreated?.();
    }
  };
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      setError(null);
    },
  });
  const input = "mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/20";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-background/60 p-3 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={dialog}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-ticket-title"
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-pop"
        noValidate
      >
        <div className="shrink-0 px-6 pt-6">
          <h2 id="new-ticket-title" className="text-base font-semibold text-foreground">New ticket</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Opens an email ticket for a customer. Write your first email to them in the reply box once it&apos;s created.
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4" data-dialog-scroll-region>
          <label className="block text-sm font-medium text-foreground">
            Customer email
            <input ref={first} type="email" autoComplete="off" className={input} {...field("email")} />
          </label>
          <label className="block text-sm font-medium text-foreground">
            Customer name <span className="font-normal text-muted-foreground">(optional)</span>
            <input className={input} {...field("name")} />
          </label>
          <label className="block text-sm font-medium text-foreground">
            Subject
            <input className={input} maxLength={300} {...field("subject")} />
          </label>
          <label className="block text-sm font-medium text-foreground">
            Internal note <span className="font-normal text-muted-foreground">(optional, never sent)</span>
            <textarea rows={3} className={input} maxLength={10000} {...field("note")} />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-sm font-medium text-foreground ring-1 ring-border hover:bg-accent">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-soft hover:bg-primary/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Create ticket
          </button>
        </div>
      </form>
    </div>
  );
}
