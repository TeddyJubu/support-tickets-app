import { allTags } from "@/lib/triage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tags in use on inbox tickets, most common first
export function GET() {
  return Response.json({ tags: allTags() });
}
