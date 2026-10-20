#!/usr/bin/env node
// Fails if tracked files contain env files or secret-looking strings.
//   node scripts/secret-scan.mjs            (all tracked files)
// Prints file:line and the kind of match, never the matched value.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);

const PATTERNS = [
  ["AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["Slack token", /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ["Anthropic/OpenAI key", /\bsk-(ant-)?[A-Za-z0-9_-]{32,}/],
  // Any name containing a secret word (CLOUDFLARE_API_TOKEN, SES_ACCESS_KEY_ID…), "=" or ":"
  [
    "assigned secret",
    /\b[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*["']?\s*[=:]\s*['"]?(?!(?:test|dev|your|example|placeholder|changeme)[-_])[A-Za-z0-9/+_-]{24,}/,
  ],
];
const SKIP = /(^|\/)(package-lock\.json|.*\.(png|jpg|ico|svg|woff2?|pptx))$/;

const problems = [];
for (const file of files) {
  if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith(".example")) problems.push(`${file}: env file is tracked`);
  if (SKIP.test(file) || file === "scripts/secret-scan.mjs") continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, i) => {
    for (const [kind, re] of PATTERNS) if (re.test(line)) problems.push(`${file}:${i + 1}: ${kind}`);
  });
}

if (problems.length) {
  console.error(`Secret scan failed:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`Secret scan: ${files.length} files clean`);
