// Who is making a request: a signed-in staff member (session cookie) or nobody. Used by proxy.ts
// and by route handlers. The simulator/CLI bearer key (SIM_API_KEY) is checked separately
// (lib/sim-auth.ts) and only by the simulator's own endpoints: it never counts as staff.

import { SESSION_COOKIE, sessionUser, type StaffUser } from "./auth";

export function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export const sessionToken = (request: Request) => readCookie(request, SESSION_COOKIE);

export function staffFromRequest(request: Request): StaffUser | null {
  return sessionUser(sessionToken(request));
}

export const signInRequired = () => Response.json({ error: "Sign in required" }, { status: 401 });
export const forbidden = (message = "Not allowed") => Response.json({ error: message }, { status: 403 });

/** For every handler that returns customer, store, ticket or draft data, or acts as a person: the user or a 401 */
export function requireStaff(request: Request): StaffUser | Response {
  return staffFromRequest(request) ?? signInRequired();
}

export function requireOwner(request: Request): StaffUser | Response {
  const user = staffFromRequest(request);
  if (!user) return signInRequired();
  return user.role === "owner" ? user : forbidden("Only the owner can do this");
}

export function clientIp(request: Request) {
  // Caddy sets X-Forwarded-For to the real client address
  return (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
}

export const isHttps = (request: Request) =>
  request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";

export function sessionCookie(request: Request, token: string, expires: Date) {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires.toUTCString()}`,
    ...(isHttps(request) ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(request: Request) {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", ...(isHttps(request) ? ["Secure"] : [])].join("; ");
}
