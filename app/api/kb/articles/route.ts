import { listArticles, EDITABLE_FOLDERS, FOLDERS } from "@/lib/kb/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Article list (no bodies). ?folder= narrows it; products are listed only on request (there are many).
export function GET(request: Request) {
  const folder = new URL(request.url).searchParams.get("folder");
  // Products (one large file per brand) are only read when asked for
  const articles = listArticles(folder ? [folder] : FOLDERS.filter((f) => f !== "products"))
    .map(({ path, folder, title, tags, sensitive, status, mtimeMs }) => ({ path, folder, title, tags, sensitive, status, mtimeMs }));
  return Response.json({ articles, folders: FOLDERS, editableFolders: EDITABLE_FOLDERS });
}
