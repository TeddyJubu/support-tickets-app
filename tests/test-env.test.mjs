// Test processes can't see a live credential (scripts/test-env.ts). Every key .env.example and
// the skill's reference.md name gets a fake live value, in the environment and in each env file
// Next reads, and none may reach the browser-test server, the unit-test helpers or the QA
// harness. Failures name keys, never values.

import { scratch, importApp, root } from "./helpers.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const { NEXT_ENV_FILES, QA_LIVE_KEYS, SAFE_KEYS, nextStartEnv, scrubEnv } = await importApp("scripts/test-env.ts");

const read = (path) => readFileSync(new URL(path, root), "utf8");
const KEYS = [
  ...new Set([
    ...[...read(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
    ...[...read(".claude/skills/helpdesk-control/reference.md").matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map((m) => m[1]),
  ]),
];
const LIVE = "live-value-from-env-local";
// A key added later and documented nowhere must not get through either
const ALL = [...KEYS, "SOME_FUTURE_SECRET"];
const liveEnv = () => ({ ...Object.fromEntries(ALL.map((k) => [k, LIVE])), PATH: process.env.PATH, HOME: process.env.HOME });
const node = (args, opts) =>
  spawnSync(process.execPath, ["--no-warnings", "--import", fileURLToPath(new URL("scripts/register-ts.mjs", root)), ...args], { encoding: "utf8", ...opts });

/** No live value anywhere, and every documented key absent or blank unless the harness sets it itself */
function assertNoLiveKey(env, own = []) {
  assert.deepEqual(Object.keys(env).filter((k) => env[k]?.includes(LIVE)), [], "these keys kept their live values");
  assert.deepEqual(KEYS.filter((k) => env[k] && !own.includes(k)), [], "these keys reached the test environment");
}

test("the documented keys include every credential, and none of them is allow-listed", () => {
  for (const k of ["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_SHOP", "SHOPIFY_ADMIN_TOKEN", "BACKUP_S3_URL", "BACKUP_S3_ACCESS_KEY_ID"]) assert.ok(KEYS.includes(k), k);
  for (const k of ["BACKUP_S3_SECRET_ACCESS_KEY", "CLOUDFLARE_API_TOKEN", "HELPDESK_AWS_SECRET_ACCESS_KEY", "INBOUND_EMAIL_TOKEN", "SIM_API_KEY", "ALERT_EMAIL"]) assert.ok(KEYS.includes(k), k);
  assert.deepEqual(KEYS.filter((k) => SAFE_KEYS.includes(k) || k.startsWith("LC_")), []);
});

test("browser-test server: next start gets no live key, from the environment or the project's env files", () => {
  // A project folder with all four env files Next reads, each key in one of them, in each form dotenv accepts
  const dir = join(scratch, "next-project");
  mkdirSync(dir);
  const forms = [(k) => `${k}=${LIVE}`, (k) => `export ${k}="${LIVE}"`, (k) => `${k} = '${LIVE}'  # comment`, (k) => `${k}: ${LIVE}`];
  NEXT_ENV_FILES.forEach((file, i) => writeFileSync(join(dir, file), ALL.filter((_, j) => j % 4 === i).map(forms[i]).join("\n") + "\n"));

  const own = ["HELPDESK_DATA_DIR", "HELPDESK_KB_DIR", "AUTO_DRAFTS"];
  const env = nextStartEnv(dir, { HELPDESK_DATA_DIR: join(scratch, "e2e"), HELPDESK_KB_DIR: join(scratch, "e2e", "kb"), AUTO_DRAFTS: "0" }, liveEnv());
  assertNoLiveKey(env, own);

  // What the server ends up with: Next's own env loader, called as `next start` calls it
  const load = (childEnv) => {
    const script = `require("@next/env").loadEnvConfig(${JSON.stringify(dir)}, false, { info() {}, error() {} }); process.stdout.write(JSON.stringify(process.env));`;
    const out = spawnSync(process.execPath, ["-e", script], { cwd: fileURLToPath(root), env: childEnv, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout);
  };
  // Unprotected, Next would load every key from those files: the checks below aren't vacuous
  const bare = load({ PATH: process.env.PATH, HOME: process.env.HOME });
  assert.deepEqual(ALL.filter((k) => bare[k] !== LIVE), [], "the fixture's env files should load without protection");

  assertNoLiveKey(load(env), own);
  // Each layer holds alone: the blanks if a later Next ignores __NEXT_PROCESSED_ENV, the marker if a key were missed
  const { __NEXT_PROCESSED_ENV, ...blanksOnly } = env;
  assert.equal(__NEXT_PROCESSED_ENV, "true");
  assertNoLiveKey(load(blanksOnly), own);
  assertNoLiveKey(load(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""))), own);
});

test("unit-test helpers: importing helpers.mjs leaves no live key", () => {
  const script = `await import(${JSON.stringify(new URL("tests/helpers.mjs", root).href)}); console.log("ENV" + JSON.stringify(process.env));`;
  const out = node(["--input-type=module", "-e", script], { cwd: scratch, env: liveEnv() });
  assert.equal(out.status, 0, out.stderr);
  const line = out.stdout.split("\n").find((l) => l.startsWith("ENV"));
  assertNoLiveKey(JSON.parse(line.slice(3)), ["HELPDESK_DATA_DIR", "HELPDESK_KB_DIR", "SIM_API_KEY"]);
});

test("QA harness, offline as npm run verify runs it: no live key", () => {
  const dump = join(scratch, "qa-env.json");
  const probe = join(scratch, "qa-probe.mjs");
  writeFileSync(probe, `import { writeFileSync } from "node:fs";\nprocess.on("exit", () => writeFileSync(${JSON.stringify(dump)}, JSON.stringify(process.env)));\n`);
  const out = node(["--import", pathToFileURL(probe).href, fileURLToPath(new URL("scripts/qa.ts", root)), "--only", "S01"], { cwd: scratch, env: liveEnv() });
  assert.equal(out.status, 0, out.stderr);
  assertNoLiveKey(JSON.parse(readFileSync(dump, "utf8")), ["HELPDESK_DATA_DIR", "HELPDESK_KB_DIR"]);
});

test("QA harness --live keeps only the Workers AI keys and the store's name", () => {
  const env = liveEnv();
  scrubEnv(QA_LIVE_KEYS, env);
  assert.deepEqual(ALL.filter((k) => env[k]).sort(), ["CF_MODEL", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "SENDER_NAME", "STORE_DESCRIPTION", "STORE_NAME", "SUPPORT_EMAIL"]);
});
