import { activeStaff } from "@/lib/auth";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The signed-in user, plus the staff list for assignee pickers
export function GET(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  return Response.json({
    user,
    staff: activeStaff().map(({ id, username, displayName }) => ({ id, username, displayName })),
  });
}
