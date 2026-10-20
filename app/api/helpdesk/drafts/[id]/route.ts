import { setDraftState } from "@/lib/drafting/drafts";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff action on an AI draft: { state: "used" | "dismissed" | "ready" }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { state?: string } | null;
  if (!/^\d+$/.test(id) || !["used", "dismissed", "ready"].includes(body?.state ?? "")) {
    return Response.json({ error: "state must be used, dismissed or ready" }, { status: 400 });
  }
  const result = setDraftState(Number(id), body!.state as "used" | "dismissed" | "ready", user.username);
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.draft);
}
