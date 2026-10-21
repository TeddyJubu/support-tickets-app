"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";

// Only same-site paths, so ?next= can't send someone to another site
// (browsers read a backslash as a slash, so "/\evil.com" means "//evil.com")
const safeNext = (v: string | null) => (v && /^\/(?![/\\])/.test(v) && !/[\\\r\n\t]/.test(v) ? v : "/");

export function LoginForm() {
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
