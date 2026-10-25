import { importApp } from "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { parseExportDate } = await importApp("lib/helpdesk-format.ts");

test("unmarked SQLite timestamps are parsed as UTC while explicit zones are preserved", () => {
  assert.equal(parseExportDate("2026-10-24 09:30:00").toISOString(), "2026-10-24T09:30:00.000Z");
  assert.equal(parseExportDate("2026-10-24 09:30:00+02:00").toISOString(), "2026-10-24T07:30:00.000Z");
  assert.equal(parseExportDate("2026-10-24T09:30:00Z").toISOString(), "2026-10-24T09:30:00.000Z");
});
