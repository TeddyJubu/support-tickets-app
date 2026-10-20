import { searchKb } from "@/lib/kb/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KB search for the copilot and the KB page (signed-in staff; proxy.ts enforces it)
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const q = p.get("q") ?? "";
  if (!q.trim()) return Response.json({ error: "q is required" }, { status: 400 });
  return Response.json(await searchKb(q, Number(p.get("k")) || 5));
}
