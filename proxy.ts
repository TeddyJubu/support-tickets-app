import { NextResponse, type NextRequest } from "next/server";
import { isAgentRequest } from "@/lib/auth";

// The helpdesk holds real customer data: every page and API route needs a signed-in agent
// (or the operator's Bearer SIM_API_KEY), except sign-in itself and the SES webhook,
// which checks its own ?token=. Route handlers check again (lib/auth.ts).
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/api/helpdesk/inbound/ses", "/robots.txt"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || isAgentRequest(request)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Build assets (JS, CSS, fonts) hold no data
  matcher: ["/((?!_next/static/).*)"],
};
