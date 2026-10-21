import { Suspense } from "react";
import type { Metadata } from "next";
import { storeSettings } from "@/lib/settings";
import { LoginForm } from "./login-form";

// Rendered per request, so the store name comes from this install's .env.local
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: `Sign in · ${storeSettings().name} support` };
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
            <h1 className="text-base font-semibold tracking-tight text-foreground">{storeSettings().name} support</h1>
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
