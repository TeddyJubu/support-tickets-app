import { claimEmailReply, completeEmailReply, emailThread, failEmailReply } from "@/lib/sim-db";
import { EmailNotSentError, sendEmail } from "@/lib/aws-email";
import { currentAgent, isAgentRequest, unauthorized } from "@/lib/auth";
import { storeSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Agent reply on an email ticket: sent to the customer from the store's support address via SES,
// then saved on the ticket. Needs a signed-in agent; Caddy also guards /api/helpdesk/email/* with basic auth.
// The client sends an idempotency key per reply; retrying with the same key never emails twice.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAgentRequest(request)) return unauthorized();
  const { id } = await params;
  const input = (await request.json().catch(() => null)) as { body?: string; idempotencyKey?: string } | null;
  const text = input?.body?.trim().slice(0, 10000) ?? "";
  const key = input?.idempotencyKey ?? "";
  if (!text) return Response.json({ error: "body is required" }, { status: 400 });
  if (!/^[\w-]{16,100}$/.test(key)) return Response.json({ error: "idempotencyKey is required" }, { status: 400 });

  const thread = emailThread(id);
  if (!thread) return Response.json({ error: "Not an email ticket" }, { status: 404 });

  const claim = claimEmailReply(key, id, text);
  if (claim.state === "sent") return Response.json(claim.detail, { status: 200 });
  if (claim.state === "conflict") {
    return Response.json({ error: "This idempotency key was used for a different reply" }, { status: 422 });
  }
  if (claim.state === "unknown") {
    return Response.json(
      { error: "This reply is still sending, or it may already have been emailed. Reload the ticket before sending it again." },
      { status: 409 },
    );
  }

  let messageId: string;
  if (claim.state === "unsaved") {
    // Emailed on an earlier attempt, but not saved: save it now
    messageId = claim.messageId;
  } else {
    try {
      messageId = await sendEmail({
        to: thread.to,
        subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
        text,
        inReplyTo: thread.messageIds.at(-1),
        references: thread.messageIds,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Send failed";
      // Only a definite rejection frees the key for a resend; otherwise the email may have gone out
      if (err instanceof EmailNotSentError) failEmailReply(key, message);
      return Response.json({ error: message }, { status: 502 });
    }
  }

  try {
    // The customer sees the store's sender name; the ticket records which agent wrote it
    const agent = currentAgent(request);
    const sender = agent?.name ?? storeSettings().senderName;
    return Response.json(completeEmailReply(key, id, messageId, text, sender, agent?.id), { status: 201 });
  } catch (err) {
    console.error(`email reply ${key} on ${id}: sent as ${messageId} but not saved`, err);
    return Response.json(
      { error: "The email was sent but couldn't be saved. Send again to save it; it won't be emailed twice." },
      { status: 500 },
    );
  }
}
