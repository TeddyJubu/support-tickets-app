// Sign-in gate for the whole site (Next.js 16 proxy, runs on Node.js).
//   - public: the login page and endpoint, health/readiness, and the SES inbound and Shopify
//     webhooks (which check their own signatures)
//   - the simulator's own endpoints (SIMULATOR below) also take the simulator/CLI bearer key
//     (SIM_API_KEY); they touch simulated tickets only. No other route accepts the key.
//   - everything else: a staff session; pages redirect to /login, APIs answer 401
// Cookie-authenticated writes must come from this site (Origin check) to stop CSRF.

import { NextResponse, type NextRequest } from "next/server";
import { isSimulatorRequest } from "@/lib/sim-auth";
import { staffFromRequest } from "@/lib/request-auth";

const PUBLIC = ["/login", "/api/auth/login", "/api/health", "/api/ready", "/api/helpdesk/inbound/ses", "/api/shopify/webhooks", "/robots.txt"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const isPublic = (path: string) => PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));

// What the simulator/CLI key opens: open a simulated ticket, write on one, list those waiting on
// the customer. Each handler checks the key again and refuses tickets that aren't simulated.
const SIMULATOR: Array<[method: string, path: RegExp]> = [
  ["POST", /^\/api\/helpdesk\/sim\/tickets$/],
  ["POST", /^\/api\/helpdesk\/sim\/tickets\/SIM-\d+\/messages$/],
  ["GET", /^\/api\/helpdesk\/sim\/awaiting$/],
];
const isSimulatorPath = (method: string, path: string) => SIMULATOR.some(([m, p]) => m === method && p.test(path));

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  // Scheme counts too: behind Caddy the site is https (X-Forwarded-Proto), so http://host isn't us
  const proto = request.headers.get("x-forwarded-proto") === "https" ? "https:" : request.nextUrl.protocol;
  try {
    return new URL(origin).origin === `${proto}//${request.headers.get("host")}`;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (isPublic(path)) return NextResponse.next();

  if (isSimulatorPath(request.method, path) && isSimulatorRequest(request)) return NextResponse.next();

  if (staffFromRequest(request)) {
    if (!SAFE_METHODS.has(request.method) && !sameOrigin(request)) {
      return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  // Behind Caddy the server only knows itself as localhost: build the URL from the Host the
  // browser used (Caddy passes it through) and the original scheme
  const proto = request.headers.get("x-forwarded-proto") === "https" ? "https" : request.nextUrl.protocol.replace(":", "");
  const login = new URL(`${proto}://${request.headers.get("host") ?? request.nextUrl.host}/login`);
  if (path !== "/") login.searchParams.set("next", `${path}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
