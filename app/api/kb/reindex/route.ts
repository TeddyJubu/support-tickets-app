import { audit } from "@/lib/auth";
import { indexStatus, rebuildIndex } from "@/lib/kb/index";
import { requireOwner } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts a rebuild in the background; poll /api/kb/status. The last good index keeps serving.
export function POST(request: Request) {
  const user = requireOwner(request);
  if (user instanceof Response) return user;
  if (indexStatus().state === "running") return Response.json(indexStatus(), { status: 202 });
  audit(user.username, "kb_reindex");
  rebuildIndex(`console:${user.username}`).catch(() => {});
  return Response.json({ ...indexStatus(), state: "running" }, { status: 202 });
}
