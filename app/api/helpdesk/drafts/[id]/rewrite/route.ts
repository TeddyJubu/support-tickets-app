import { getDraft } from "@/lib/drafting/drafts";
import { rewriteDraft, RewriteBusyError } from "@/lib/drafting/rewrite";
import { AiError, aiConfig } from "@/lib/workers-ai";
import { audit } from "@/lib/auth";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Edit reply with AI": { instruction, text } → { text }. text is the current reply-box text
// (which may already be edited); the draft id ties the revision to its source.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  if (!aiConfig()) return Response.json({ error: "Workers AI is not configured" }, { status: 503 });
  const { id } = await params;
  const draft = /^\d+$/.test(id) ? getDraft(Number(id)) : null;
  if (!draft) return Response.json({ error: "Draft not found" }, { status: 404 });
  if (draft.state !== "ready") return Response.json({ error: "This draft is no longer current" }, { status: 409 });
  const body = (await request.json().catch(() => null)) as { instruction?: unknown; text?: unknown } | null;
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  const text = typeof body?.text === "string" && body.text.trim() ? body.text : draft.body;
  if (!instruction || instruction.length > 1000) return Response.json({ error: "Say how to change the reply (up to 1000 characters)" }, { status: 400 });
  if (!text.trim()) return Response.json({ error: "There's no text to rewrite yet" }, { status: 400 });
  if (text.length > 10_000) return Response.json({ error: "The reply is too long to rewrite (10,000 characters max)" }, { status: 400 });
  try {
    const out = await rewriteDraft({ text, instruction, sensitive: draft.sensitive });
    // A customer message may have arrived while the AI worked: don't hand back a stale rewrite
    if (getDraft(draft.id)?.state !== "ready") return Response.json({ error: "The customer wrote again while rewriting: this draft is out of date" }, { status: 409 });
    audit(user.username, "draft_rewrite", draft.ticketId, { draftId: draft.id });
    return Response.json({ ...out, draftId: draft.id });
  } catch (err) {
    if (err instanceof RewriteBusyError) return Response.json({ error: err.message }, { status: 429 });
    const message = err instanceof Error ? err.message : "Rewrite failed";
    return Response.json({ error: message }, { status: err instanceof AiError && err.kind === "transient" ? 503 : 502 });
  }
}
