// npm run migrate — apply pending migrations to data/*.db and print the schema versions.
// The server and worker also migrate on startup; this is for checking or running it by hand.

import { closeDatabases, dataDir, schemaVersion } from "@/lib/db";
import { getDb } from "@/lib/sim-db";

console.log(`data ${dataDir()}`);
console.log(`sim.db schema ${schemaVersion(getDb())}`);
closeDatabases();
