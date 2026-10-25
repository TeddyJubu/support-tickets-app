// Knowledge base: articles, safe saving, index builds, hybrid search, notices, product sync.

import { scratch, importApp, call, staffSession } from "./helpers.mjs";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const kbDir = process.env.HELPDESK_KB_DIR;
const files = await importApp("lib/kb/files.ts");
const articleNames = await importApp("lib/kb/article-name.ts");
const index = await importApp("lib/kb/index.ts");
const search = await importApp("lib/kb/search.ts");
const notices = await importApp("lib/kb/notices.ts");
const ai = await importApp("lib/workers-ai.ts");
const articleRoute = await importApp("app/api/kb/article/route.ts");
const noticesRoute = await importApp("app/api/kb/notices/route.ts");
const reindexRoute = await importApp("app/api/kb/reindex/route.ts");

const owner = await staffSession({ role: "owner", displayName: "Olive" });
const agent = await staffSession({ displayName: "Andy" });

function put(path, text) {
  mkdirSync(join(kbDir, path.split("/")[0]), { recursive: true });
  writeFileSync(join(kbDir, path), text);
}

put(
  "policies/returns.md",
  `---
title: Return policy
category: policies
status: confirmed
tags: [returns, refund-window]
---

## How long customers have

Returns are accepted within 14 days of delivery for store credit.

## Final sale

Final sale items can't be returned.
`,
);
put("faq/shipping.md", `---\ntitle: 'Buttons Bebe shipping times'\ntags: [shipping]\n---\n\n## Processing\n\nButtons Bebe orders ship in 24 to 48 hours.\n`);
put("intents/README.md", "not indexed");

test("front matter, tag normalization, sensitivity and chunks", () => {
  const a = files.readArticle("policies/returns.md");
  assert.equal(a.title, "Return policy");
  assert.deepEqual(a.tags, ["returns", "refund-window"]);
  assert.equal(a.sensitive, true, "refund-window marks it sensitive");
  const chunks = files.chunkArticle(a);
  assert.deepEqual(chunks.map((c) => c.heading), ["How long customers have", "Final sale"]);
  const shipping = files.readArticle("faq/shipping.md");
  assert.equal(shipping.sensitive, false);
  assert.equal(shipping.title, "Cute Things shipping times");
  assert.match(shipping.body, /Cute Things orders ship/);
  assert.doesNotMatch(shipping.raw, /Buttons Bebe/);
  const quoted = files.parseArticle("faq/quoted.md", "---\ntitle: 'A kid''s return policy'\n---\n\nText\n");
  assert.equal(quoted.title, "A kid's return policy");
  assert.ok(!files.listArticles().some((x) => x.path.endsWith("README.md")));
});

test("article titles generate short, safe Markdown filenames", () => {
  assert.equal(articleNames.articleFilenameFromTitle("  Return & Exchange: Café / Kids!  "), "return-exchange-cafe-kids.md");
  assert.equal(articleNames.articleFilenameFromTitle("!!!"), null);
  const file = articleNames.articleFilenameFromTitle("A ".repeat(100));
  assert.match(file, /^[a-z0-9][a-z0-9-]{0,99}\.md$/);
});

test("paths outside the KB folders are refused", () => {
  for (const p of ["../sim.db", "policies/../../x.md", "policies/a/b.md", "secrets/x.md", "policies/.hidden.md", "policies/x.txt"]) {
    assert.equal(files.safePath(p), null, p);
  }
  assert.equal(files.readArticle("../../etc/passwd"), null);
});

test("saving keeps up to 20 earlier versions and detects concurrent edits", () => {
  const before = files.readArticle("faq/shipping.md");
  for (let i = 0; i < 22; i++) files.writeArticle("faq/shipping.md", `${before.raw}\n<!-- ${i} -->\n`);
  assert.equal(files.backupCount("faq/shipping.md"), 20);
  const current = files.readArticle("faq/shipping.md");
  assert.throws(() => files.writeArticle("faq/shipping.md", "x", { expectedMtimeMs: current.mtimeMs - 5000 }), /Someone else changed/);
  assert.throws(() => files.writeArticle("faq/shipping.md", "x", { create: true }), /already exists/);
  assert.throws(() => files.writeArticle("products/x.md", "x", { create: true }), /can only be saved/);
});

test("keyword-only index builds without Workers AI and finds articles", async () => {
  const status = await index.rebuildIndex("test");
  assert.equal(status.state, "idle", status.error);
  assert.equal(status.embeddings, false);
  assert.equal(status.docs, 2);
  const out = await search.searchKb("how many days to return");
  assert.equal(out.mode, "keyword");
  assert.equal(out.results[0].path, "policies/returns.md");
  assert.equal(out.results[0].sensitive, true);
  const shipping = await search.searchKb("shipping times");
  assert.equal(shipping.results[0].title, "Cute Things shipping times");
  assert.match(shipping.results[0].text, /Cute Things orders/);
  assert.doesNotMatch(JSON.stringify(shipping.results), /Buttons Bebe/);

  // Normalize the result from a previously built index too, before a re-index runs.
  const built = new DatabaseSync(index.kbDbPath());
  built.prepare(`UPDATE docs SET title = ? WHERE path = ?`).run("Buttons Bebe shipping times", "faq/shipping.md");
  built.prepare(`UPDATE chunks SET text = ? WHERE path = ?`).run("Buttons Bebe orders ship in 24 to 48 hours.", "faq/shipping.md");
  built.close();
  const legacyIndex = await search.searchKb("shipping times");
  assert.equal(legacyIndex.results[0].title, "Cute Things shipping times");
  assert.match(legacyIndex.results[0].text, /Cute Things orders/);
  assert.doesNotMatch(JSON.stringify(legacyIndex.results), /Buttons Bebe/);
});

test("FTS syntax in a query can't break or widen the search", async () => {
  for (const q of ['" OR 1=1 --', "NEAR(a b)", "*", "returns AND NOT"]) {
    const out = await search.searchKb(q);
    assert.ok(Array.isArray(out.results), q);
  }
});

test("a failed rebuild keeps serving the last good index", async () => {
  const good = statSync(index.kbDbPath()).mtimeMs;
  // Make embedding fail: configured Workers AI that errors
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
  process.env.CLOUDFLARE_API_TOKEN = "token";
  ai.setAiFetch(async () => new Response("nope", { status: 500 }));
  const status = await index.rebuildIndex("test-fail");
  assert.equal(status.state, "failed");
  assert.equal(statSync(index.kbDbPath()).mtimeMs, good);
  assert.ok(!readdirSync(scratch).some((f) => f.includes(".building-")), "temp file removed");
  assert.equal((await search.searchKb("final sale")).results[0].path, "policies/returns.md");
});

test("hybrid search with embeddings ranks by meaning too", async () => {
  // Fake embeddings: a 1024-d vector with weight on a few "concept" dimensions
  const concepts = { return: 0, refund: 0, ship: 1, dispatch: 1, final: 2 };
  const vec = (text) => {
    const v = new Array(1024).fill(0.001);
    for (const [word, dim] of Object.entries(concepts)) if (text.toLowerCase().includes(word)) v[dim] += 1;
    return v;
  };
  ai.setAiFetch(async (_url, init) => {
    const { text } = JSON.parse(init.body);
    return Response.json({ success: true, result: { data: text.map(vec), shape: [text.length, 1024] } });
  });
  const status = await index.rebuildIndex("test-hybrid");
  assert.equal(status.embeddings, true, status.error);
  // No word in common with any article: only the meaning match can find it
  const out = await search.searchKb("dispatch speed");
  assert.equal(out.mode, "hybrid");
  assert.equal(out.results[0].path, "faq/shipping.md");
  // Workers AI down at query time: keyword results still come back
  ai.setAiFetch(async () => {
    throw new Error("network down");
  });
  const fallback = await search.searchKb("final sale");
  assert.equal(fallback.mode, "keyword");
  assert.ok(fallback.results.length);
  ai.setAiFetch(null);
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
});

test("only the owner can edit articles; agents can read", async () => {
  const read = await call(articleRoute.GET, { url: "http://t/api/kb/article?path=policies/returns.md", headers: { cookie: agent.cookie } });
  assert.equal(read.status, 200);
  const legacyRead = await call(articleRoute.GET, { url: "http://t/api/kb/article?path=faq/shipping.md", headers: { cookie: agent.cookie } });
  assert.equal(legacyRead.json.title, "Cute Things shipping times");
  assert.doesNotMatch(legacyRead.json.raw, /Buttons Bebe/);
  const raw = read.json.raw.replace("14 days", "21 days");
  const denied = await call(articleRoute.PUT, { method: "PUT", headers: { cookie: agent.cookie }, body: { path: "policies/returns.md", raw } });
  assert.equal(denied.status, 403);
  const ok = await call(articleRoute.PUT, {
    method: "PUT",
    headers: { cookie: owner.cookie },
    body: { path: "policies/returns.md", raw, expectedMtimeMs: read.json.mtimeMs },
  });
  assert.equal(ok.status, 200, ok.text);
  assert.match(files.readArticle("policies/returns.md").raw, /21 days/);
  const created = await call(articleRoute.POST, { method: "POST", headers: { cookie: owner.cookie }, body: { path: "faq/new-topic.md", raw: "---\ntitle: New\n---\n\n## A\n\nB\n" } });
  assert.equal(created.status, 201);
  const traversal = await call(articleRoute.POST, { method: "POST", headers: { cookie: owner.cookie }, body: { path: "faq/../../evil.md", raw: "x" } });
  assert.equal(traversal.status, 400);
});

test("re-index is owner only and runs in the background", async () => {
  assert.equal((await call(reindexRoute.POST, { method: "POST", headers: { cookie: agent.cookie } })).status, 403);
  const r = await call(reindexRoute.POST, { method: "POST", headers: { cookie: owner.cookie } });
  assert.equal(r.status, 202);
  for (let i = 0; i < 50 && index.indexStatus().state === "running"; i++) await new Promise((res) => setTimeout(res, 50));
  assert.equal(index.indexStatus().state, "idle");
});

test("notices: validated, owner only, returned with every search until ended or expired", async () => {
  assert.equal((await call(noticesRoute.POST, { method: "POST", headers: { cookie: agent.cookie }, body: { title: "x", body: "y" } })).status, 403);
  assert.equal((await call(noticesRoute.POST, { method: "POST", headers: { cookie: owner.cookie }, body: { title: "", body: "y" } })).status, 400);
  assert.equal(
    (await call(noticesRoute.POST, { method: "POST", headers: { cookie: owner.cookie }, body: { title: "Past", body: "y", expiresAt: "2001-01-01" } })).status,
    400,
  );
  const r = await call(noticesRoute.POST, {
    method: "POST",
    headers: { cookie: owner.cookie },
    body: { title: "Pickup closed Friday", body: "No pickups this Friday.", expiresAt: new Date(Date.now() + 86400e3).toISOString() },
  });
  assert.equal(r.status, 201);
  let out = await search.searchKb("pickup");
  assert.deepEqual(out.notices.map((n) => n.title), ["Pickup closed Friday"]);
  assert.ok(notices.endNotice(r.json.id, "owner"));
  out = await search.searchKb("pickup");
  assert.equal(out.notices.length, 0);
  assert.equal(notices.listNotices()[0].active, false);
});

test("product sync writes one article per brand and refuses a collapsed catalog", async () => {
  const db = new DatabaseSync(join(scratch, "helpdesk.db"));
  db.exec(`CREATE TABLE products (handle TEXT, title TEXT, vendor TEXT, type TEXT, tags TEXT, description TEXT,
    price_min REAL, price_max REAL, options TEXT, inventory INTEGER, final_sale INTEGER, status TEXT, published INTEGER)`);
  const insert = db.prepare(`INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("tulle-dress", "Tulle Dress", "Petite Amalie", "Dress", "girls", "<p>Soft tulle</p>", 89, 99, "Size: 2,4,6", 3, 0, "active", 1);
  insert.run("lace-top", "Lace Top", "Petite Amalie", "Top", "", "", 40, 40, "", 0, 1, "active", 1);
  insert.run("knit", "Knit", "Bebe Organic", "Sweater", "", "", 55, 55, "", 2, 0, "active", 1);
  insert.run("old", "Old", "Gone Brand", "x", "", "", 1, 1, "", 0, 0, "archived", 0);
  db.close();
  const { syncProducts } = await importApp("lib/kb/products.ts");
  const r = syncProducts();
  assert.deepEqual({ ok: r.ok, products: r.products, files: r.files }, { ok: true, products: 3, files: 2 });
  const amalie = files.readArticle("products/petite-amalie.md");
  assert.match(amalie.raw, /## Tulle Dress[\s\S]*\$89\.00–\$99\.00[\s\S]*Soft tulle/);
  assert.match(amalie.raw, /Final sale: yes/);
  assert.ok(!existsSync(join(kbDir, "products", "gone-brand.md")));

  // An export that lost most products is refused and the published files stay
  const shrink = new DatabaseSync(join(scratch, "helpdesk.db"));
  shrink.exec(`DELETE FROM products WHERE handle IN ('tulle-dress', 'lace-top')`);
  shrink.close();
  const refused = syncProducts();
  assert.equal(refused.ok, false);
  assert.match(refused.error, /was 3/);
  assert.match(files.readArticle("products/petite-amalie.md").raw, /## Tulle Dress/);
  assert.ok(existsSync(join(kbDir, "products", "bebe-organic.md")));
});
