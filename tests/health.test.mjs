// /api/health and /api/ready

import { importApp, call } from "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const health = await importApp("app/api/health/route.ts");
const ready = await importApp("app/api/ready/route.ts");

test("health is always ok and carries no data", async () => {
  const r = await call(health.GET);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
});

test("ready reports a migrated database", async () => {
  const r = await call(ready.GET);
  assert.equal(r.status, 200);
  assert.equal(r.json.ready, true);
  assert.equal(r.json.checks.database.ok, true);
  // No KB index in a fresh data folder: still ready to serve, but not healthy
  assert.equal(r.json.checks.knowledgeBase.ok, false);
  assert.equal(r.json.healthy, false);
});
