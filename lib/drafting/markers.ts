// The model returns its draft and verdict between markers that carry a fresh random token
// per run. Customer text can't forge them: "<<<" and ">>>" in anything we put into the
// prompt are neutralised, and blocks with any other token are ignored.

import { randomBytes } from "node:crypto";
import { SEVERITY_RANK, type Severity } from "../classifier";

export const newRunToken = () => randomBytes(8).toString("hex");

/** For customer messages, ticket fields and tool output placed in the prompt */
export const neutralize = (text: string) => String(text ?? "").replace(/<{3,}/g, "‹‹‹").replace(/>{3,}/g, "›››");

export const markers = (token: string) => ({
  draftOpen: `<<<DRAFT ${token}>>>`,
  draftClose: `<<<END DRAFT ${token}>>>`,
  resultOpen: `<<<RESULT ${token}>>>`,
  resultClose: `<<<END RESULT ${token}>>>`,
});

export interface Verdict {
  action: "reply" | "needs_staff";
  severity: Severity;
  sensitive: boolean;
  missingFacts: string[];
  staffNextStep: string | null;
  kbUsed: string[];
  reason: string;
}

export type Extracted = { ok: true; draft: string; verdict: Verdict } | { ok: false; error: string };

function blocks(text: string, open: string, close: string) {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const a = text.indexOf(open, from);
    if (a < 0) break;
    const b = text.indexOf(close, a + open.length);
    if (b < 0) break;
    out.push(text.slice(a + open.length, b).trim());
    from = b + close.length;
  }
  return out;
}

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, 10) : []);

function parseVerdict(raw: string): Verdict | null {
  let json: Record<string, unknown>;
  try {
    // Tolerate a fenced block around the JSON
    json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const action = json.action === "needs_staff" ? "needs_staff" : json.action === "reply" ? "reply" : null;
  const severity = (typeof json.severity === "string" && Object.hasOwn(SEVERITY_RANK, json.severity) ? json.severity : null) as Severity | null;
  if (!action || !severity) return null;
  return {
    action,
    severity,
    sensitive: json.sensitive === true,
    missingFacts: list(json.missing_facts),
    staffNextStep: str(json.staff_next_step) || null,
    kbUsed: list(json.kb_used),
    reason: str(json.reason),
  };
}

// Template text echoed back instead of a real answer ("placeholder", "(the email to the customer)")
const PLACEHOLDER = /^[\s"'`([{<]*(?:placeholder|tbd|todo|n\/?a|\.{3}|…|lorem ipsum|the email to the customer|email (?:body|here)|(?:your )?(?:draft|reply|response)(?: here)?)[\s"'`)\]}>.]*$/i;
export const isPlaceholder = (text: string | null) => !!text && PLACEHOLDER.test(text.trim());
/** A real email has a greeting and a sentence; fewer than this many letters isn't one */
const MIN_DRAFT_LETTERS = 12;
// The model narrating its own steps instead of writing the email ("Searching the knowledge base for…")
const NARRATION = /^(?:let me |i(?:['’]ll| will| am|['’]m) (?:now )?|now )?(?:search(?:ing)?|look(?:ing)? up|check(?:ing)?|call(?:ing)?|us(?:e|ing)|query(?:ing)?|consult(?:ing)?|review(?:ing)?)\b[^\n]{0,100}\b(?:knowledge[- ]base|kb|search_kb|get_order|get_returns|get_customer_tickets|tools?|database)\b/i;
// An email opens with a greeting ("Hi Ana,", "שלום צפורה,"); without one it needs at least two sentences
const GREETING = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening)|shalom|mazel tov|congratulations|thank you|thanks)\b|,\s*$/i;
export function isStubDraft(draft: string) {
  const lines = draft.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  if (NARRATION.test(lines[0])) return true;
  const sentences = (draft.match(/[.!?](?=\s|$)/g) ?? []).length;
  return !GREETING.test(lines[0]) && sentences < 2;
}

/** Pulls the draft and verdict out of the model's answer; several verdicts merge to the most cautious */
export function extract(answer: string, token: string): Extracted {
  const m = markers(token);
  const drafts = blocks(answer, m.draftOpen, m.draftClose);
  const verdicts = blocks(answer, m.resultOpen, m.resultClose).map(parseVerdict);
  if (!verdicts.length) return { ok: false, error: "The AI answer had no result block" };
  if (verdicts.some((v) => !v)) return { ok: false, error: "The AI result block wasn't valid" };
  const all = verdicts as Verdict[];
  const verdict = all.reduce((acc, v) => ({
    action: acc.action === "needs_staff" || v.action === "needs_staff" ? "needs_staff" : "reply",
    severity: SEVERITY_RANK[v.severity] > SEVERITY_RANK[acc.severity] ? v.severity : acc.severity,
    sensitive: acc.sensitive || v.sensitive,
    missingFacts: [...new Set([...acc.missingFacts, ...v.missingFacts])],
    staffNextStep: acc.staffNextStep ?? v.staffNextStep,
    kbUsed: [...new Set([...acc.kbUsed, ...v.kbUsed])],
    reason: acc.reason || v.reason,
  }));
  const draft = drafts.at(-1) ?? "";
  if (verdict.action === "reply" && !draft) return { ok: false, error: "The AI said it drafted a reply but sent none" };
  if (isPlaceholder(draft) || isPlaceholder(verdict.staffNextStep)) return { ok: false, error: "The AI returned placeholder text instead of a reply" };
  if (draft && (draft.match(/\p{L}/gu) ?? []).length < MIN_DRAFT_LETTERS) return { ok: false, error: "The AI's draft was too short to be a real reply" };
  if (draft && isStubDraft(draft)) return { ok: false, error: "The AI described its own steps instead of writing the email to the customer: write the full reply, starting with a greeting" };
  return { ok: true, draft, verdict };
}
