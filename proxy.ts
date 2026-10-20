// Sign-in gate for the whole site (Next.js 16 proxy, runs on Node.js).
//   - public: the login page and endpoint, health/readiness, and the SES inbound webhook
//     (which checks its own token)
//   - /api/helpdesk/*: a staff session, or the simulator/CLI bearer key (SIM_API_KEY)
//   - everything else: a staff session; pages redirect to /login, APIs answer 401
// Cookie-authenticated writes must come from this site (Origin check) to stop CSRF.

import { NextResponse, type NextRequest } from "next/server";
import { isSimulatorRequest } from "@/lib/sim-auth";
import { staffFromRequest } from "@/lib/request-auth";

const PUBLIC = ["/login", "/api/auth/login", "/api/health", "/api/ready", "/api/helpdesk/inbound/ses", "/robots.txt"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const isPublic = (path: string) => PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (isPublic(path)) return NextResponse.next();

  if (path.startsWith("/api/helpdesk/") && isSimulatorRequest(request)) return NextResponse.next();

  if (staffFromRequest(request)) {
    if (!SAFE_METHODS.has(request.method) && !sameOrigin(request)) {
      return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  // A relative Location: behind Caddy the server only knows itself as localhost
  const next = path === "/" ? "" : `?next=${encodeURIComponent(`${path}${request.nextUrl.search}`)}`;
  return new NextResponse(null, { status: 307, headers: { location: `/login${next}` } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
