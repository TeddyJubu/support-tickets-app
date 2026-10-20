"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";

// Only same-site paths, so ?next= can't send someone to another site
const safeNext = (v: string | null) => (v && v.startsWith("/") && !v.startsWith("//") ? v : "/");

function LoginForm() {
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Sign-in failed (HTTP ${res.status})`);
        setPassword("");
        return;
      }
      window.location.assign(safeNext(params.get("next")));
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
      <label className="block">
        <span className="text-sm font-medium text-foreground">Username</span>
        <input
          autoFocus
          autoComplete="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError(null);
          }}
          className="mt-1.5 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-foreground">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          className="mt-1.5 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-soft">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.6_0.2_320)] shadow-soft">
            <svg viewBox="0 0 24 24" className="size-5 text-white" aria-hidden>
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="9.5" cy="9.5" r="1.4" fill="currentColor" />
              <circle cx="14.5" cy="9.5" r="1.4" fill="currentColor" />
              <circle cx="9.5" cy="14.5" r="1.4" fill="currentColor" />
              <circle cx="14.5" cy="14.5" r="1.4" fill="currentColor" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground">Buttons Bebe support</h1>
            <p className="text-sm text-muted-foreground">Sign in to continue</p>
          </div>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
