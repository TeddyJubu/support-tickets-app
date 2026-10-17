import { addSimMessage, emailThread, recordEmailId } from "@/lib/sim-db";
import { sendEmail } from "@/lib/aws-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Agent reply on an email ticket: sent to the customer from support@teddyonfriday.com via SES,
// then saved on the ticket. Caddy guards /api/helpdesk/email/* with basic auth.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const text = ((await request.json().catch(() => null)) as { body?: string } | null)?.body?.trim() ?? "";
  if (!text) return Response.json({ error: "body is required" }, { status: 400 });

  const thread = emailThread(id);
  if (!thread) return Response.json({ error: "Not an email ticket" }, { status: 404 });

  try {
    const messageId = await sendEmail({
      to: thread.to,
      subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
      text: text.slice(0, 10000),
      inReplyTo: thread.messageIds.at(-1),
      references: thread.messageIds,
    });
    recordEmailId(messageId, id);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 502 });
  }
  return Response.json(addSimMessage(id, "agent", text.slice(0, 10000), "Cute Things Support"), { status: 201 });
}
