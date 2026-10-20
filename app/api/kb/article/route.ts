import { audit } from "@/lib/auth";
import { backupCount, readArticle, safePath, writeArticle, EDITABLE_FOLDERS } from "@/lib/kb/files";
import { requireOwner } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One article: GET ?path=folder/name.md; PUT saves (owner); POST creates (owner).
// Saving doesn't reindex: the page offers "Re-index to apply".
export function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  const article = readArticle(path);
  if (!article) return Response.json({ error: "Article not found" }, { status: 404 });
  return Response.json({ ...article, editable: EDITABLE_FOLDERS.includes(article.folder), versions: backupCount(article.path) });
}

async function save(request: Request, create: boolean) {
  const user = requireOwner(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { path?: unknown; raw?: unknown; expectedMtimeMs?: unknown } | null;
  const path = safePath(String(body?.path ?? ""), EDITABLE_FOLDERS);
  if (!path) return Response.json({ error: "Name the article like policies/my-topic.md (letters, digits, - and _)" }, { status: 400 });
  if (typeof body?.raw !== "string" || !body.raw.trim()) return Response.json({ error: "The article is empty" }, { status: 400 });
  try {
    const article = writeArticle(path, body.raw, {
      create,
      expectedMtimeMs: typeof body.expectedMtimeMs === "number" ? body.expectedMtimeMs : undefined,
    });
    audit(user.username, create ? "kb_create" : "kb_save", null, { path });
    return Response.json({ ...article, editable: true, versions: backupCount(path) }, { status: create ? 201 : 200 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 409 });
  }
}

export const PUT = (request: Request) => save(request, false);
export const POST = (request: Request) => save(request, true);
