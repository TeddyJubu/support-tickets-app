import { retryDraft } from "@/lib/drafting/queue";
import { aiDraftState } from "@/lib/drafting/state";
import { getDb } from "@/lib/sim-db";
import { audit } from "@/lib/auth";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json(aiDraftState(getDb(), id));
}

// Ask for a new AI draft of the latest customer message
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!getDb().prepare(`SELECT 1 FROM sim_tickets WHERE id = ?`).get(id)) return Response.json({ error: "Ticket not found" }, { status: 404 });
  const result = retryDraft(getDb(), id);
  if (result.queued) audit(user.username, "draft_retry", id, { jobId: result.jobId });
  return Response.json({ ...result, ...aiDraftState(getDb(), id) }, { status: result.queued ? 202 : 409 });
}
