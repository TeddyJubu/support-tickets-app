import { createHash, timingSafeEqual } from "node:crypto";
import PostalMime from "postal-mime";
import { ingestEmail } from "@/lib/sim-db";
import { getInboundEmail } from "@/lib/aws-email";
import { MAX_ATTACHMENTS, saveAttachment } from "@/lib/attachments";

const MAX_BODY = 20000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AWS SES (the store's SUPPORT_EMAIL, us-west-2) -> SNS topic helpdesk-inbound-email
// (S3 bucket + notification) -> this route -> new ticket, or a reply on the existing thread.
// ponytail: auth is a secret ?token= in the SNS subscription URL plus a TopicArn match;
// add SNS signature verification if the URL could leak.
const ok = (info?: object) => Response.json(info ?? {}, { status: 200 });

function tokenMatches(given: string) {
  const expected = process.env.INBOUND_EMAIL_TOKEN ?? "";
  return !!expected && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// Keep only the new part of a reply: cut at "On ... wrote:" / Outlook headers, drop "> " lines.
function stripQuoted(text: string) {
  const cut = text.search(/^\s*(On [\s\S]{1,300}?wrote:|-{2,}\s*Original Message\s*-{2,}|From: .+\r?\nSent: )/im);
  const head = cut > 0 ? text.slice(0, cut) : text;
  return head.split(/\r?\n/).filter((l) => !l.startsWith(">")).join("\n").trim();
}

const msgIds = (v?: string) => (v ?? "").match(/<[^>]+>/g) ?? [];

export async function POST(request: Request) {
  if (!tokenMatches(new URL(request.url).searchParams.get("token") ?? "")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sns = (await request.json().catch(() => null)) as Record<string, string> | null;
  if (!sns || sns.TopicArn !== process.env.INBOUND_SNS_TOPIC_ARN) {
    return Response.json({ error: "Unknown topic" }, { status: 403 });
  }

  if (sns.Type === "SubscriptionConfirmation") {
    const url = new URL(sns.SubscribeURL);
    if (url.protocol !== "https:" || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)) {
      return Response.json({ error: "Bad SubscribeURL" }, { status: 400 });
    }
    await fetch(url);
    return ok();
  }
  if (sns.Type !== "Notification") return ok();

  const msg = JSON.parse(sns.Message);
  const receipt = msg.receipt ?? {};
  if (receipt.spamVerdict?.status === "FAIL" || receipt.virusVerdict?.status === "FAIL") return ok({ dropped: true });

  // S3 action: the email is in the bucket (any size). Legacy SNS action: base64 content inline.
  const action = receipt.action ?? {};
  const raw =
    action.type === "S3"
      ? await getInboundEmail(action.bucketName, action.objectKey)
      : msg.content
        ? Buffer.from(msg.content, "base64")
        : null;
  if (!raw) return ok({ dropped: true });
  const mail = await PostalMime.parse(raw);
  const from = mail.from?.address?.toLowerCase();
  if (!from) return ok({ dropped: true });
  const [firstName, ...rest] = (mail.from?.name || from.split("@")[0]).trim().split(/\s+/);
  const text =
    mail.text || mail.html?.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/[ \t]+/g, " ") || "";
  // Files are stored content-addressed before the database write, so an SNS retry is harmless
  const attachments = mail.attachments.slice(0, MAX_ATTACHMENTS).map((a) =>
    saveAttachment(
      typeof a.content === "string" ? Buffer.from(a.content) : new Uint8Array(a.content),
      a.filename || "attachment",
      a.mimeType,
    ),
  );
  const fullBody = stripQuoted(text) || text.trim();
  const dropped = mail.attachments.length - attachments.length;
  const body =
    (fullBody.slice(0, MAX_BODY) || "(empty message)") +
    (dropped > 0 ? `\n\n[${dropped} more attachment${dropped === 1 ? "" : "s"} not imported: only the first ${MAX_ATTACHMENTS} are kept]` : "");

  const result = ingestEmail({
    customer: { sourceKey: `email:${createHash("sha256").update(from).digest("hex")}`, firstName, lastName: rest.join(" "), email: from },
    subject: (mail.subject || "(no subject)").slice(0, 300),
    body,
    truncated: fullBody.length > MAX_BODY,
    attachments,
    channel: "email",
    tags: "email",
    sourceTicketId: mail.messageId ?? null,
    messageId: mail.messageId ?? `ses:${msg.mail?.messageId}`,
    refs: [...msgIds(mail.inReplyTo), ...msgIds(mail.references)],
  });
  return ok(result);
}
