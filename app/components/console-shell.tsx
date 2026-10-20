"use client";

// Frame for the console pages other than the inbox: brand, page links, signed-in user.

import { LogOut } from "lucide-react";
import { AppNav } from "./app-nav";
import { SessionProvider, useSession } from "./context/session-context";
import { BrandMark } from "./layout/demo-sidebar";
import { Avatar, IconButton } from "./ui";

function UserBadge() {
  const { user, signOut } = useSession();
  if (!user) return null;
  return (
    <div className="flex items-center gap-2">
      <Avatar name={user.displayName} size="sm" />
      <span className="hidden text-sm font-medium text-foreground sm:inline">{user.displayName}</span>
      <IconButton label="Sign out" onClick={signOut}>
        <LogOut className="size-4" />
      </IconButton>
    </div>
  );
}

export function ConsoleShell({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur">
          <BrandMark />
          <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
          <AppNav className="ml-2" />
          <div className="ml-auto flex items-center gap-3">
            {actions}
            <UserBadge />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </SessionProvider>
  );
}
