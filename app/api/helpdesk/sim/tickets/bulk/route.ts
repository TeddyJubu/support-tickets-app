import { applyChanges, parseChanges } from "@/lib/triage";
import { actorFromRequest, signInRequired } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Triage many tickets at once: { ids: [...], changes: {...} }, all or nothing
export async function POST(request: Request) {
  const actor = actorFromRequest(request);
  if (!actor) return signInRequired();
  const body = (await request.json().catch(() => null)) as { ids?: unknown; changes?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string" && /^SIM-\d+$/.test(x)) : [];
  if (!ids.length || ids.length > 100) return Response.json({ error: "ids: 1–100 ticket ids" }, { status: 400 });
  const parsed = parseChanges(body?.changes);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const updated = applyChanges([...new Set(ids)], parsed.changes, actor.name, actor.kind === "staff" ? actor.user.id : null);
  return Response.json({ updated });
}
