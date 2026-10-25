"use client";

// Frame for the console pages other than the inbox: brand, page links, signed-in user.

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { AppNav } from "./app-nav";
import { NotificationBell } from "./notification-bell";
import { SessionProvider, useSession } from "./context/session-context";
import { Avatar, BrandMark, IconButton, Popover } from "./ui";
import { apiJson, jsonInit } from "./api";

const isPlaceholderName = (value: string | null | undefined) =>
  /^(?:your name|yourname)$/i.test(value?.trim() ?? "");

function UserBadge() {
  const { user, signOut, setDisplayName } = useSession();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeDisplayName = user?.displayName?.trim();
  const safeUsername = user?.username?.trim();
  const identity = safeDisplayName && !isPlaceholderName(safeDisplayName)
    ? safeDisplayName
    : safeUsername && !isPlaceholderName(safeUsername)
      ? safeUsername
      : "Staff account";
  const role = user?.role === "owner" ? "Owner" : "Agent";

  const save = async (event: React.FormEvent<HTMLFormElement>, close: () => void) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await apiJson<{ user: { displayName: string } }>("/api/auth/me", jsonInit("PATCH", { displayName: draft }));
      setDisplayName(result.user.displayName);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update your display name");
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div role="group" aria-label="Account: Staff account" className="flex min-w-0 items-center gap-2">
        <Avatar name="Staff account" size="sm" />
        <span className="hidden text-sm font-medium text-foreground sm:inline">Staff account</span>
      </div>
    );
  }

  return (
    <div role="group" aria-label={`Account: ${identity}`} className="flex min-w-0 items-center gap-2">
      <Popover align="right" panelClassName="fixed right-3 top-28 z-[70] max-h-[calc(100dvh-8rem)] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto p-0 sm:right-4 xl:right-6 xl:top-16 xl:max-h-[calc(100dvh-5rem)]" trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={() => {
            if (!open) {
              setDraft(isPlaceholderName(user.displayName) ? "" : user.displayName);
              setError(null);
            }
            toggle();
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Profile: ${identity}`}
          title="Edit profile"
          className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-accent"
        >
          <Avatar name={identity} size="sm" />
          <span className="hidden min-w-0 sm:block">
            <span className="block max-w-36 truncate text-sm font-medium leading-tight text-foreground">{identity}</span>
            <span className="block text-xs leading-tight text-muted-foreground">{role}</span>
          </span>
        </button>
      )}>
        {(close) => (
          <form onSubmit={(event) => save(event, close)} className="space-y-3 p-4" role="dialog" aria-label="Edit your profile">
            <div>
              <h2 className="text-sm font-semibold">Your profile</h2>
              <p className="mt-1 text-xs text-muted-foreground">Your display name appears on replies and staff activity.</p>
              {isPlaceholderName(user.displayName) && <p className="mt-1 text-xs text-warning">Set a display name to replace the placeholder shown on the account.</p>}
            </div>
            <label className="block text-sm font-medium">
              Display name
              <input
                autoComplete="name"
                autoFocus
                maxLength={60}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                aria-describedby={error ? "profile-name-error" : undefined}
              />
            </label>
            {error && <p id="profile-name-error" role="alert" className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="h-8 rounded-lg px-3 text-sm ring-1 ring-border hover:bg-accent">Cancel</button>
              <button type="submit" disabled={busy} className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {busy ? "Saving…" : "Save name"}
              </button>
            </div>
          </form>
        )}
      </Popover>
      <IconButton label="Sign out" onClick={signOut}>
        <LogOut className="size-4" />
      </IconButton>
    </div>
  );
}

export function AppHeader({
  title,
  storeName = "Helpdesk",
  actions,
  onOpenTicket,
}: {
  title: string;
  storeName?: string;
  actions?: React.ReactNode;
  onOpenTicket?: (id: string) => void;
}) {
  useEffect(() => {
    document.title = `${title} · ${storeName} Support`;
  }, [storeName, title]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto grid w-full max-w-screen-2xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4 xl:grid-cols-[15rem_minmax(0,1fr)_auto] xl:gap-x-5">
        <div className="flex min-w-0 items-center gap-2.5 xl:w-60">
          <BrandMark />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{title}</h1>
        </div>
        <AppNav className="col-span-2 row-start-2 -mx-1 min-w-0 overflow-x-auto xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:mx-0 xl:overflow-visible" />
        <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-2 sm:gap-3 xl:col-start-3">
          {actions}
          <UserBadge />
          <NotificationBell align="right" onOpenTicket={onOpenTicket} />
        </div>
      </div>
    </header>
  );
}

export function ConsoleShell({
  title,
  storeName,
  actions,
  children,
}: {
  title: string;
  storeName?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <AppHeader title={title} storeName={storeName} actions={actions} />
        <main className="flex-1">{children}</main>
      </div>
    </SessionProvider>
  );
}
