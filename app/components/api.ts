// fetch() for the helpdesk's own API: a 401 means the session ended, which the dashboard
// turns into a "Sign in to continue" prompt instead of a broken screen.

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export async function apiFetch(input: string, init?: RequestInit) {
  const res = await fetch(input, init);
  if (res.status === 401) onUnauthorized?.();
  return res;
}

export async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `Request failed (HTTP ${res.status})`);
  return body as T;
}

export const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
