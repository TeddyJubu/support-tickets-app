import { activeStaff, updateDisplayName } from "@/lib/auth";
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

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") === "https" ? "https:" : url.protocol;
  const host = request.headers.get("host") ?? url.host;
  try {
    return new URL(origin).origin === `${proto}//${host}`;
  } catch {
    return false;
  }
}

export async function PATCH(request: Request) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request blocked" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { displayName?: unknown } | null;
  if (typeof body?.displayName !== "string") {
    return Response.json({ error: "Enter a display name" }, { status: 400 });
  }
  const displayName = body.displayName.normalize("NFC").replace(/\s+/gu, " ").trim();
  const length = Array.from(displayName).length;
  if (!length || length > 60 || /[\u0000-\u001f\u007f-\u009f]/u.test(displayName)) {
    return Response.json({ error: "Use a display name between 1 and 60 characters" }, { status: 400 });
  }
  if (/^(?:your name|yourname)$/i.test(displayName)) {
    return Response.json({ error: "Choose a display name other than the placeholder" }, { status: 400 });
  }

  const updated = updateDisplayName(user.id, displayName);
  if (!updated) return Response.json({ error: "Your staff account is no longer active" }, { status: 404 });
  return Response.json({ user: updated });
}
