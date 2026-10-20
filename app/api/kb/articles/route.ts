import { listArticles, EDITABLE_FOLDERS, FOLDERS } from "@/lib/kb/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Article list (no bodies). ?folder= narrows it; products are listed only on request (there are many).
export function GET(request: Request) {
  const folder = new URL(request.url).searchParams.get("folder");
  const articles = listArticles()
    .filter((a) => (folder ? a.folder === folder : a.folder !== "products"))
    .map(({ path, folder, title, tags, sensitive, status, mtimeMs }) => ({ path, folder, title, tags, sensitive, status, mtimeMs }));
  return Response.json({ articles, folders: FOLDERS, editableFolders: EDITABLE_FOLDERS });
}
