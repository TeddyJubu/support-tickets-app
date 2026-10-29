import { allTags } from "@/lib/triage";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tags in use on inbox tickets, most common first
export function GET(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  return Response.json({ tags: allTags() });
}
