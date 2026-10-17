import { createHash, timingSafeEqual } from "node:crypto";
import PostalMime from "postal-mime";
import { ingestEmail } from "@/lib/sim-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AWS SES (support@teddyonfriday.com, us-west-2) -> SNS topic helpdesk-inbound-email
// (raw MIME, base64) -> this route -> new ticket, or a reply on the existing thread.
// ponytail: auth is a secret ?token= in the SNS subscription URL plus a TopicArn match;
// add SNS signature verification if the URL could leak. SES->SNS caps mail at 150 KB.
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
  if (receipt.spamVerdict?.status === "FAIL" || receipt.virusVerdict?.status === "FAIL" || !msg.content) {
    return ok({ dropped: true });
  }

  const mail = await PostalMime.parse(Buffer.from(msg.content, "base64"));
  const from = mail.from?.address?.toLowerCase();
  if (!from) return ok({ dropped: true });
  const [firstName, ...rest] = (mail.from?.name || from.split("@")[0]).trim().split(/\s+/);
  const text =
    mail.text || mail.html?.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/[ \t]+/g, " ") || "";
  const attachments = mail.attachments.map((a) => a.filename).filter(Boolean);
  const body = (stripQuoted(text) || text.trim()).slice(0, 20000) || "(empty message)";

  const result = ingestEmail({
    customer: { sourceKey: createHash("sha256").update(from).digest("hex"), firstName, lastName: rest.join(" "), email: from },
    subject: (mail.subject || "(no subject)").slice(0, 300),
    body: attachments.length ? `${body}\n\n[Attachments not imported: ${attachments.join(", ")}]` : body,
    tags: "email",
    sourceTicketId: mail.messageId ?? null,
    messageId: mail.messageId ?? `ses:${msg.mail?.messageId}`,
    refs: [...msgIds(mail.inReplyTo), ...msgIds(mail.references)],
  });
  return ok(result);
}
