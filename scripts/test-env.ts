// What test processes may see of the environment. The browser-test server (e2e-server.ts), the
// unit-test helpers (tests/helpers.mjs) and the QA harness (qa.ts) keep only this allow-list,
// so no credential from the shell or .env.local reaches a test, including keys added after
// this list was written. tests/test-env.test.mjs checks every key .env.example and the skill's
// reference.md name.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Inherited as is: what the OS, Node and the tooling need. None of them reaches a service. */
export const SAFE_KEYS: readonly string[] = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "TZ",
  "TERM",
  "FORCE_COLOR",
  "NO_COLOR",
  "CI",
  "NODE_ENV",
  // node --test runs each test file in a child that reports to the runner through this
  "NODE_TEST_CONTEXT",
];
const isSafe = (key: string) => SAFE_KEYS.includes(key) || key.startsWith("LC_");

/** npm run qa -- --live drafts with the real Workers AI model, under this install's store name */
export const QA_LIVE_KEYS: readonly string[] = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CF_MODEL", "STORE_NAME", "STORE_DESCRIPTION", "SUPPORT_EMAIL", "SENDER_NAME"];

/** Delete every variable that isn't on the allow-list or in keep (process.env by default) */
export function scrubEnv(keep: readonly string[] = [], env: NodeJS.ProcessEnv = process.env) {
  for (const key of Object.keys(env)) if (!isSafe(key) && !keep.includes(key)) delete env[key];
}

/** The env files `next start` reads from its project folder (@next/env, production mode) */
export const NEXT_ENV_FILES = [".env.production.local", ".env.local", ".env.production", ".env"];

/** Names of the keys the env files in dir define (dotenv syntax: `KEY=`, `export KEY=`, `KEY: `) */
export function envFileKeys(dir: string) {
  const keys = new Set<string>();
  for (const file of NEXT_ENV_FILES) {
    let text = "";
    try {
      text = readFileSync(join(dir, file), "utf8");
    } catch {}
    for (const m of text.matchAll(/^\s*(?:export\s+)?([\w.-]+)\s*(?:=|:\s)/gm)) keys.add(m[1]);
  }
  return [...keys];
}

/**
 * The whole environment for `next start` in dir: the allow-listed variables of env, plus vars.
 * Next loads the project's .env files by itself, so they're shut out twice:
 * __NEXT_PROCESSED_ENV tells it they were applied already (Next's own child processes inherit
 * it for the same reason), and every key they define is set to "", since Next never overrides
 * a variable that is set.
 */
export function nextStartEnv(dir: string, vars: Record<string, string>, env: NodeJS.ProcessEnv = process.env) {
  const out: NodeJS.ProcessEnv = { ...env };
  scrubEnv([], out);
  Object.assign(out, vars, { __NEXT_PROCESSED_ENV: "true" });
  for (const key of envFileKeys(dir)) if (!(key in out)) out[key] = "";
  return out;
}
