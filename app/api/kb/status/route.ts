import { kbHealth } from "@/lib/kb/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(kbHealth());
}
