// Knowledge-base maintenance (server only):
//   npm run kb -- import <path-to-Shopify-help-desk/kb>   copy intents/faq/policies/tickets into data/kb
//   npm run kb -- index                                    rebuild the search index
//   npm run kb -- products                                 regenerate product articles, then reindex
//   npm run kb -- search <query>                           try a search
//   npm run kb -- status

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { EDITABLE_FOLDERS, kbDir } from "@/lib/kb/files";
import { indexStatus, rebuildIndex } from "@/lib/kb/index";
import { syncProducts } from "@/lib/kb/products";
import { searchKb } from "@/lib/kb/search";
import { loadEnv } from "./env";

loadEnv();
const [command, ...rest] = process.argv.slice(2);

async function main() {
  if (command === "import") {
    const source = resolve(rest[0] ?? "");
    if (!rest[0] || !existsSync(source)) throw new Error("Usage: npm run kb -- import <path to a kb folder with intents/, faq/, …>");
    let copied = 0;
    for (const folder of EDITABLE_FOLDERS) {
      const from = join(source, folder);
      if (!existsSync(from)) continue;
      mkdirSync(join(kbDir(), folder), { recursive: true });
      for (const name of readdirSync(from)) {
        if (!name.endsWith(".md") || name.toLowerCase() === "readme.md") continue;
        const to = join(kbDir(), folder, name);
        if (existsSync(to)) continue; // never overwrite local edits
        cpSync(join(from, name), to);
        copied++;
      }
    }
    console.log(`copied ${copied} articles into ${kbDir()} (existing files kept); run: npm run kb -- index`);
  } else if (command === "index") {
    const status = await rebuildIndex("cli");
    console.log(status);
    if (status.state !== "idle") process.exitCode = 1;
  } else if (command === "products") {
    const sync = syncProducts();
    console.log(sync);
    if (!sync.ok) process.exitCode = 1;
    else {
      const status = await rebuildIndex("product-sync");
      console.log(status);
      if (status.state !== "idle") process.exitCode = 1;
    }
  } else if (command === "search") {
    const out = await searchKb(rest.join(" "), 5);
    console.log(`mode ${out.mode}; ${out.notices.length} active notices`);
    for (const r of out.results) console.log(`${r.score.toFixed(4)}  ${r.path}  ${r.heading ?? ""}${r.sensitive ? "  [SENSITIVE]" : ""}`);
  } else if (command === "status") {
    console.log(indexStatus());
  } else {
    console.log("npm run kb -- import <dir> | index | products | search <query> | status");
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
