import { overview } from "@/lib/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(overview());
}
