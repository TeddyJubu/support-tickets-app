import { INLINE_TYPES, readAttachment } from "@/lib/attachments";
import { requireStaff } from "@/lib/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// An email attachment, for signed-in staff only. Raster images display inline; everything else
// downloads as an opaque file, so nothing a customer sent can run in the helpdesk's origin.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = requireStaff(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const file = /^\d+$/.test(id) ? readAttachment(Number(id)) : null;
  if (!file) return Response.json({ error: "Attachment not found" }, { status: 404 });
  const inline = INLINE_TYPES.test(file.contentType);
  return new Response(new Uint8Array(file.content), {
    headers: {
      "content-type": inline ? file.contentType : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-store",
    },
  });
}
