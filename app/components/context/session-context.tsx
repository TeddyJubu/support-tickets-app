"use client";

// The signed-in staff member, the staff list (for assignee pickers) and session expiry.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { apiFetch, setUnauthorizedHandler } from "../api";

export interface StaffMember {
  id: number;
  username: string;
  displayName: string;
}

export interface SessionUser extends StaffMember {
  email: string | null;
  role: "owner" | "agent";
}

interface SessionContextType {
  user: SessionUser | null;
  staff: StaffMember[];
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used within SessionProvider");
  return context;
}

function SignInAgain() {
  const next = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="session-ended">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-pop">
        <p id="session-ended" className="text-base font-semibold text-foreground">Sign in to continue</p>
        <p className="mt-1 text-sm text-muted-foreground">Your session ended. Anything you typed is still in this tab.</p>
        <a
          href={`/login?next=${encodeURIComponent(next)}`}
          target="_blank"
          rel="noopener"
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-soft hover:bg-primary/90"
        >
          <LogIn className="size-4" />
          Sign in (new tab)
        </a>
        <button type="button" onClick={() => window.location.reload()} className="mt-2 block w-full text-xs text-muted-foreground hover:text-foreground">
          I signed in, reload this page
        </button>
      </div>
    </div>
  );
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setExpired(true));
    apiFetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { user: SessionUser; staff: StaffMember[] } | null) => {
        if (!data) return;
        setUser(data.user);
        setStaff(data.staff);
      })
      .catch(() => {});
    return () => setUnauthorizedHandler(null);
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // A full page load on purpose, so no customer data stays in memory
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }, []);

  return (
    <SessionContext.Provider value={{ user, staff, signOut }}>
      {children}
      {expired && <SignInAgain />}
    </SessionContext.Provider>
  );
}
