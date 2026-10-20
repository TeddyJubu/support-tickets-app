import { createReview } from "@/lib/sending";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 1 of sending: record exactly what will go out, to whom, answering which message
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { body?: unknown } | null;
  const result = createReview(id, user, typeof body?.body === "string" ? body.body : "");
  if ("code" in result) return Response.json({ error: result.error, code: result.code }, { status: result.status });
  return Response.json(result);
}
