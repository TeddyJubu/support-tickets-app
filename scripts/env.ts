// Loads .env.local into process.env for server-side scripts (never prints values)
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadEnv(root = process.cwd()) {
  try {
    for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
