import { listAlerts } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner alert log, newest first (?offset=)
export function GET(request: Request) {
  const offset = Math.max(0, Number(new URL(request.url).searchParams.get("offset")) || 0);
  return Response.json(listAlerts(offset, 25));
}
