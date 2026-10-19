import { AwsClient } from "aws4fetch";

// Scoped IAM user helpdesk-friday: s3:GetObject on the inbound bucket, SES send from support@ only.
const region = process.env.HELPDESK_AWS_REGION ?? "us-west-2";

function client(service: string) {
  const accessKeyId = process.env.HELPDESK_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HELPDESK_AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error("AWS email credentials are not configured");
  return new AwsClient({ accessKeyId, secretAccessKey, region, service });
}

// Raw MIME that SES stored for an inbound email (no size cap, unlike SES -> SNS content).
export async function getInboundEmail(bucket: string, key: string) {
  if (bucket !== process.env.INBOUND_EMAIL_BUCKET || !/^inbound\/[\w.-]+$/.test(key)) {
    throw new Error("Unexpected inbound object");
  }
  const res = await client("s3").fetch(`https://${bucket}.s3.${region}.amazonaws.com/${key}`);
  if (!res.ok) throw new Error(`S3 GetObject failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string[];
}

const clean = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
const b64 = (v: string) => Buffer.from(v, "utf8").toString("base64");
const isMsgId = (v: string) => /^<[^\s<>]+>$/.test(v);

export function buildMime(from: string, m: OutboundEmail) {
  const refs = (m.references ?? []).filter(isMsgId).slice(-20);
  const headers = [
    `From: ${clean(from)}`,
    `To: ${clean(m.to)}`,
    `Subject: =?UTF-8?B?${b64(clean(m.subject))}?=`,
    m.inReplyTo && isMsgId(m.inReplyTo) ? `In-Reply-To: ${m.inReplyTo}` : "",
    refs.length ? `References: ${refs.join(" ")}` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  return `${headers.join("\r\n")}\r\n\r\n${b64(m.text).replace(/.{1,76}/g, "$&\r\n")}`;
}

// Returns the Message-ID header SES puts on the sent mail, for threading the customer's reply.
export async function sendEmail(m: OutboundEmail) {
  const from = process.env.OUTBOUND_EMAIL_FROM ?? "Cute Things Support <support@teddyonfriday.com>";
  const res = await client("ses").fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ Content: { Raw: { Data: Buffer.from(buildMime(from, m)).toString("base64") } } }),
  });
  const body = (await res.json().catch(() => null)) as { MessageId?: string; message?: string } | null;
  if (!res.ok || !body?.MessageId) throw new Error(body?.message ?? `SES send failed: HTTP ${res.status}`);
  // SES uses email.amazonses.com in us-east-1 and <region>.amazonses.com elsewhere
  const domain = region === "us-east-1" ? "email.amazonses.com" : `${region}.amazonses.com`;
  return `<${body.MessageId}@${domain}>`;
}
