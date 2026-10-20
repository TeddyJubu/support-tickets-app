"use client";

// Triage controls for the open inbox ticket: priority, assignee, tags, snooze and more.

import { useState } from "react";
import {
  Flag,
  UserRound,
  UserX,
  Tag,
  Plus,
  X,
  AlarmClock,
  MoreHorizontal,
  Mail,
  Trash2,
  ShieldAlert,
  RotateCcw,
  ChevronDown,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIORITIES, type Ticket } from "@/lib/helpdesk-types";
import { useDashboard } from "../context/dashboard-context";
import { useSession } from "../context/session-context";
import { Avatar, MenuDivider, MenuItem, MenuLabel, Popover, PRIORITY_META, snoozeOptions } from "../ui";

const chip =
  "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset ring-border hover:bg-accent";

function TagEditor({ ticket }: { ticket: Ticket }) {
  const { updateTicket } = useDashboard();
  const [draft, setDraft] = useState("");
  const tags = ticket.tagList ?? [];
  const add = async () => {
    const tag = draft.trim().toLowerCase().replace(/\s+/g, "-");
    if (!tag || tags.includes(tag)) return setDraft("");
    if (await updateTicket({ addTag: tag }, ticket.id)) setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span key={t} className="inline-flex h-7 items-center gap-1 rounded-full bg-muted pl-2.5 pr-1 text-xs text-foreground">
          {t}
          <button
            type="button"
            aria-label={`Remove tag ${t}`}
            onClick={() => updateTicket({ removeTag: t }, ticket.id)}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Popover
        panelClassName="w-56 p-2"
        trigger={({ toggle }) => (
          <button type="button" onClick={toggle} className={cn(chip, "text-muted-foreground")} title="Add a tag">
            {tags.length ? <Plus className="size-3.5" /> : <Tag className="size-3.5" />}
            {!tags.length && "Tag"}
          </button>
        )}
      >
        {(close) => (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await add();
              close();
            }}
            className="flex gap-1.5"
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={40}
              placeholder="New tag"
              aria-label="New tag"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
            />
            <button type="submit" className="rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground">
              Add
            </button>
          </form>
        )}
      </Popover>
    </div>
  );
}

export function TriageBar({ ticket }: { ticket: Ticket }) {
  const { updateTicket, setTicketStatus } = useDashboard();
  const { staff, user } = useSession();
  const priority = ticket.priority ?? "normal";
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.normal;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5">
      <Popover
        trigger={({ toggle, open }) => (
          <button type="button" onClick={toggle} aria-expanded={open} className={cn(chip, meta.tone)} title="Priority">
            <Flag className="size-3.5" />
            {meta.label}
            <ChevronDown className="size-3 opacity-60" />
          </button>
        )}
      >
        {(close) =>
          PRIORITIES.map((p) => (
            <MenuItem
              key={p}
              icon={Flag}
              label={PRIORITY_META[p].label}
              checked={priority === p}
              onSelect={() => {
                close();
                if (p !== priority) updateTicket({ priority: p }, ticket.id, `Priority set to ${p}`);
              }}
            />
          ))
        }
      </Popover>

      <Popover
        trigger={({ toggle, open }) => (
          <button type="button" onClick={toggle} aria-expanded={open} className={chip} title="Assignee">
            {ticket.assignee ? (
              <Avatar name={ticket.assignee.displayName} size="sm" className="!size-4 !text-[8px]" />
            ) : (
              <UserRound className="size-3.5 text-muted-foreground" />
            )}
            <span className={cn(!ticket.assignee && "text-muted-foreground")}>{ticket.assignee?.displayName ?? "Unassigned"}</span>
            <ChevronDown className="size-3 opacity-60" />
          </button>
        )}
      >
        {(close) => (
          <>
            {user && ticket.assignee?.id !== user.id && (
              <>
                <MenuItem icon={UserRound} label="Assign to me" onSelect={() => (close(), updateTicket({ assigneeId: user.id }, ticket.id, "Assigned to you"))} />
                <MenuDivider />
              </>
            )}
            {staff.map((s) => (
              <MenuItem
                key={s.id}
                label={s.displayName}
                checked={ticket.assignee?.id === s.id}
                onSelect={() => {
                  close();
                  if (ticket.assignee?.id !== s.id) updateTicket({ assigneeId: s.id }, ticket.id, `Assigned to ${s.displayName}`);
                }}
              />
            ))}
            {ticket.assignee && (
              <>
                <MenuDivider />
                <MenuItem icon={UserX} label="Unassign" onSelect={() => (close(), updateTicket({ assigneeId: null }, ticket.id, "Unassigned"))} />
              </>
            )}
          </>
        )}
      </Popover>

      <TagEditor ticket={ticket} />

      <div className="ml-auto flex items-center gap-1.5">
        {ticket.snoozedUntil ? (
          <button
            type="button"
            onClick={() => updateTicket({ snoozedUntil: null }, ticket.id, "Woken up")}
            className={cn(chip, "text-warning")}
            title="Wake now"
          >
            <AlarmClock className="size-3.5" />
            Until {new Date(ticket.snoozedUntil).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
            <X className="size-3" />
          </button>
        ) : (
          <Popover
            align="right"
            trigger={({ toggle, open }) => (
              <button type="button" onClick={toggle} aria-expanded={open} className={cn(chip, "text-muted-foreground")} title="Snooze">
                <AlarmClock className="size-3.5" />
                Snooze
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>Hide until</MenuLabel>
                {snoozeOptions().map((o) => (
                  <MenuItem
                    key={o.label}
                    label={o.label}
                    hint={o.until.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
                    onSelect={() => {
                      close();
                      updateTicket({ snoozedUntil: o.until.toISOString() }, ticket.id, "Snoozed: it comes back on its own, or when the customer writes");
                    }}
                  />
                ))}
              </>
            )}
          </Popover>
        )}

        <Popover
          align="right"
          trigger={({ toggle, open }) => (
            <button type="button" onClick={toggle} aria-expanded={open} aria-label="More actions" title="More actions" className={cn(chip, "px-1.5")}>
              <MoreHorizontal className="size-4" />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={Mail} label="Mark unread" onSelect={() => (close(), updateTicket({ read: false }, ticket.id, "Marked unread"))} />
              {ticket.status !== "pending" && (
                <MenuItem icon={RotateCcw} label="Mark waiting on customer" onSelect={() => (close(), setTicketStatus("pending", ticket.id))} />
              )}
              <MenuDivider />
              {ticket.spam ? (
                <MenuItem icon={RotateCcw} label="Not spam" onSelect={() => (close(), updateTicket({ spam: false }, ticket.id, "Moved out of spam"))} />
              ) : (
                <MenuItem icon={ShieldAlert} label="Mark as spam" onSelect={() => (close(), updateTicket({ spam: true }, ticket.id, "Marked as spam"))} />
              )}
              {ticket.trashed ? (
                <MenuItem icon={RotateCcw} label="Restore from trash" onSelect={() => (close(), updateTicket({ trashed: false }, ticket.id, "Restored"))} />
              ) : (
                <MenuItem icon={Trash2} danger label="Move to trash" onSelect={() => (close(), updateTicket({ trashed: true }, ticket.id, "Moved to trash"))} />
              )}
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}

/** Ticket subject; inbox tickets can be renamed in place */
export function EditableSubject({ ticket, editable }: { ticket: Ticket; editable: boolean }) {
  const { updateTicket } = useDashboard();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(ticket.subject ?? "");
  if (editing) {
    return (
      <form
        className="min-w-0 flex-1"
        onSubmit={async (e) => {
          e.preventDefault();
          const next = value.trim();
          if (next && next !== ticket.subject && !(await updateTicket({ subject: next }, ticket.id, "Subject renamed"))) return;
          setEditing(false);
        }}
      >
        <input
          autoFocus
          value={value}
          maxLength={300}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          aria-label="Subject"
          className="w-full rounded-md border border-input bg-background px-2 py-0.5 text-[15px] font-semibold tracking-tight text-foreground outline-none focus:border-ring"
        />
      </form>
    );
  }
  return (
    <h2 className="group/subject flex min-w-0 items-center gap-1.5 truncate text-[15px] font-semibold tracking-tight text-foreground">
      <span className="truncate">{ticket.subject ?? "(no subject)"}</span>
      {editable && (
        <button
          type="button"
          aria-label="Rename subject"
          title="Rename subject"
          onClick={() => {
            setValue(ticket.subject ?? "");
            setEditing(true);
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent group-hover/subject:opacity-100 focus-visible:opacity-100"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
    </h2>
  );
}
