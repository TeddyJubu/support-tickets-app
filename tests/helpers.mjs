// Shared test setup. Import this first in every test file:
//   import { scratch, stubModule, importApp } from "./helpers.mjs";
// Each test file gets its own empty data folder (HELPDESK_DATA_DIR), and secrets that could
// reach a real service (AWS, Cloudflare, the demo store) are removed from the environment.

import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

export const root = new URL("..", import.meta.url);

for (const k of Object.keys(process.env)) {
  if (/AWS|OUTBOUND_EMAIL|INBOUND_|CLOUDFLARE|SHOP_|CF_MODEL|ALERT_|BACKUP_/.test(k)) delete process.env[k];
}

export const scratch = mkdtempSync(join(tmpdir(), "helpdesk-test-"));
process.env.HELPDESK_DATA_DIR = scratch;
process.env.HELPDESK_KB_DIR = join(scratch, "kb");
process.env.SIM_API_KEY = "test-simulator-key-0123456789abcdef";
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef0123456789";
after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Replace a module for this test file: stubModule("@/lib/aws-email", "export const x = 1").
 * Must run before the first import of anything that loads it.
 */
export function stubModule(specifier, source) {
  const url = `data:text/javascript,${encodeURIComponent(source)}`;
  const hooks = `export async function resolve(spec, ctx, next) {
    if (spec === ${JSON.stringify(specifier)}) return { url: ${JSON.stringify(url)}, shortCircuit: true };
    return next(spec, ctx);
  }`;
  register(`data:text/javascript,${encodeURIComponent(hooks)}`);
}

/** import("@/app/api/...") with a project-relative path */
export const importApp = (path) => import(new URL(path, root).href);

/** Call a Next.js route handler */
export async function call(handler, { method = "GET", url = "http://test/", body, headers = {}, params = {} } = {}) {
  const res = await handler(
    new Request(url, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

let staffCount = 0;
/** Create a staff user and a session; returns { user, cookie } for request headers */
export async function staffSession({ role = "agent", displayName } = {}) {
  const auth = await importApp("lib/auth.ts");
  const username = `staff${++staffCount}`;
  const user = auth.createUser({ username, displayName: displayName ?? `Staff ${staffCount}`, password: "correct horse battery", role });
  const { token } = auth.createSession(user.id);
  return { user, token, cookie: `${auth.SESSION_COOKIE}=${token}` };
}
