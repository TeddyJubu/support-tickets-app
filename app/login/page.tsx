import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, safeNextPath, SESSION_COOKIE } from "@/lib/auth";
import { BrandMark } from "../components/ui";

export const metadata: Metadata = { title: "Sign in · Buttons Bebe Support" };

const ERRORS: Record<string, string> = {
  invalid: "That password isn't right.",
  locked: "Too many attempts. Try again in 15 minutes.",
  setup: "Sign-in isn't set up on the server yet.",
};

// Plain form post to /api/auth/login, so it works before any JavaScript loads
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const { error, next } = await searchParams;
  const target = safeNextPath(next);
  if (readSession((await cookies()).get(SESSION_COOKIE)?.value)) redirect(target);
  const message = typeof error === "string" ? ERRORS[error] : undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <form
        method="post"
        action="/api/auth/login"
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-soft"
      >
        <div className="mb-6 flex items-center gap-3">
          <BrandMark />
          <div>
            <h1 className="text-base font-semibold text-card-foreground">Buttons Bebe Support</h1>
            <p className="text-sm text-muted-foreground">Sign in to the helpdesk</p>
          </div>
        </div>
        <input type="hidden" name="next" value={target} />
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-card-foreground">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? "login-error" : undefined}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:border-ring focus:ring-3 focus:ring-ring/20"
        />
        {message && (
          <p id="login-error" role="alert" className="mt-2 text-sm text-destructive">
            {message}
          </p>
        )}
        <button
          type="submit"
          className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-soft transition-all hover:bg-primary/90 active:scale-[0.98]"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
