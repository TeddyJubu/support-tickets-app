// Migrations and the transaction helper.

import { scratch, importApp } from "./helpers.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const { migrate, schemaVersion, transaction } = await importApp("lib/db.ts");
const { SIM_MIGRATIONS } = await importApp("lib/sim-migrations.ts");

const fresh = (name) => new DatabaseSync(join(scratch, name));

test("a fresh database ends at the latest schema", () => {
  const db = fresh("fresh.db");
  migrate(db, SIM_MIGRATIONS);
  assert.equal(schemaVersion(db), Math.max(...SIM_MIGRATIONS.map((m) => m.version)));
  assert.ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'sim_tickets'`).get());
});

test("a pre-migration database (tables, no schema_version) migrates without losing rows", () => {
  const db = fresh("legacy.db");
  SIM_MIGRATIONS[0].up(db); // what lib/sim-db.ts used to create on open
  db.exec(`INSERT INTO sim_tickets (id, subject) VALUES ('SIM-1001', 'kept')`);
  migrate(db, SIM_MIGRATIONS);
  migrate(db, SIM_MIGRATIONS); // idempotent
  assert.equal(db.prepare(`SELECT subject FROM sim_tickets WHERE id = 'SIM-1001'`).get().subject, "kept");
  assert.equal(db.prepare(`SELECT count(*) AS c FROM schema_version WHERE version = 1`).get().c, 1);
});

test("a failing migration rolls back and is not recorded", () => {
  const db = fresh("broken.db");
  const bad = [{ version: 1, name: "bad", up: (d) => d.exec(`CREATE TABLE a (x); SELECT nope FROM missing;`) }];
  assert.throws(() => migrate(db, bad));
  assert.equal(schemaVersion(db), 0);
  assert.equal(db.prepare(`SELECT count(*) AS c FROM sqlite_master WHERE name = 'a'`).get().c, 0);
});

test("nested transactions roll back only the inner part", () => {
  const db = fresh("tx.db");
  db.exec(`CREATE TABLE t (v TEXT)`);
  transaction(db, () => {
    db.exec(`INSERT INTO t VALUES ('outer')`);
    assert.throws(() =>
      transaction(db, () => {
        db.exec(`INSERT INTO t VALUES ('inner')`);
        throw new Error("boom");
      }),
    );
  });
  assert.deepEqual(db.prepare(`SELECT v FROM t`).all().map((r) => r.v), ["outer"]);
});
