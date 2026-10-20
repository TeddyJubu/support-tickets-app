import { lessonStats, listLessons, type Lesson } from "@/lib/learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lessons from delivered replies (text shown masked) and learning stats
export function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") as Lesson["status"] | null;
  const valid = status && ["pending", "approved", "rejected", "promoted"].includes(status) ? status : undefined;
  return Response.json({ stats: lessonStats(), lessons: listLessons(valid) });
}
