import { confirmSend } from "@/lib/sending";
import { pendingSend } from "@/lib/sim-db";
import { requireStaff, sessionToken } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 2: { body, reviewToken, idempotencyKey } — sends only if it still matches the review.
// Retrying with the same key never sends twice.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { body?: unknown; reviewToken?: unknown; idempotencyKey?: unknown } | null;
  const result = await confirmSend({
    ticketId: id,
    user,
    sessionToken: sessionToken(request),
    body: typeof body?.body === "string" ? body.body : "",
    reviewToken: typeof body?.reviewToken === "string" ? body.reviewToken : "",
    idempotencyKey: typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "",
  });
  if ("code" in result) return Response.json({ error: result.error, code: result.code }, { status: result.status });
  return Response.json(result.detail, { status: result.status });
}

// Send status: a reply whose outcome isn't confirmed yet (its excerpt is reply text: staff only)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  return Response.json({ pendingSend: pendingSend(id) });
}
