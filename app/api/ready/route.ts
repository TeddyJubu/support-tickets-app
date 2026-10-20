import { readiness } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Readiness: database open and migrated (plus the worker and KB checks once they exist)
export function GET() {
  const result = readiness();
  return Response.json(result, { status: result.ready ? 200 : 503 });
}
