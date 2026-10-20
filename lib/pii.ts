// Best-effort masking of personal data, ported from the Shopify helpdesk (feedback/pii.py).
// It catches patterns (emails, links, phones, cards, order and tracking numbers, addresses,
// postal codes) and names we already know. It can't find names it wasn't told about, so
// masked text is "much safer", never "guaranteed anonymous".

const PATTERNS: Array<[kind: string, re: RegExp, placeholder: string]> = [
  ["email", /[\w.+-]+@[\w-]+\.[\w.-]+/gi, "[email]"],
  ["url", /https?:\/\/[^\s)>\]]+/gi, "[link]"],
  ["tracking", /\b(1Z[0-9A-Z]{16}|\d{12,22})\b/g, "[tracking]"],
  ["order_hash", /#\s?S?\d{3,}/gi, "[order]"],
  ["order_word", /\b(order|order\s*#|order\s*no\.?)\s*[:#]?\s*S?\d{3,}\b/gi, "[order]"],
  ["payment_card", /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g, "[payment-card]"],
  ["po_box", /\bP\.?\s*O\.?\s+Box\s+[A-Z0-9-]+\b/gi, "[address]"],
  [
    "street",
    /(?<!\w)\d{1,6}\s+(?:[\w.'’-]+\s+){1,5}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Terrace|Ter|Place|Pl)\.?(?:\s+(?:Apt|Apartment|Unit|Suite|#)\s*[\w-]+)?\b/gi,
    "[address]",
  ],
  ["postal_code", /\b(?:\d{5}(?:-\d{4})?|[A-Z]\d[A-Z][ -]?\d[A-Z]\d|[A-Z]{1,2}\d[A-Z\d]?[ -]?\d[A-Z]{2})\b/gi, "[postal-code]"],
  ["phone", /(?<!\d)(?:\+?\d[\d\-.\s()]{7,}\d)(?!\d)/g, "[phone]"],
];

const GREETING_NAME = /\b(hi|hello|dear|hey)\s+([\p{L}'’-]{2,}(?:\s+[\p{L}'’-]{2,}){0,2})(?=[,!])/giu;
const NOT_NAMES = new Set(["all", "everyone", "friend", "team", "there"]);

export function piiFindings(text: string) {
  const out: Array<{ kind: string; text: string }> = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of (text ?? "").matchAll(re)) if (!out.some((f) => f.kind === kind && f.text === m[0])) out.push({ kind, text: m[0] });
  }
  return out;
}

export function maskPii(text: string) {
  let out = text ?? "";
  for (const [, re, placeholder] of PATTERNS) out = out.replace(re, placeholder);
  // Replies greet customers by first name: mask greeting-shaped names too
  return out.replace(GREETING_NAME, (whole, greeting: string, name: string) =>
    NOT_NAMES.has(name.trim().toLowerCase()) ? whole : `${greeting} [name]`,
  );
}

const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Patterns, plus names from a trusted source (full names first, then each part) */
export function maskWithNames(text: string, names: string[]) {
  let out = maskPii(text);
  const candidates = new Set<string>();
  for (const name of names.map((n) => n.trim()).filter(Boolean)) {
    candidates.add(name);
    for (const part of name.split(/[\s,]+/)) if (part.length >= 2) candidates.add(part);
  }
  for (const value of [...candidates].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escape(value)}(?![\\p{L}\\p{N}_])`, "giu"), "[name]");
  }
  return out;
}
