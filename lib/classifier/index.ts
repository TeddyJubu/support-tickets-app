// Deterministic, escalate-only triage classifier (ported from the Shopify helpdesk's
// processor/classifier/engine.py). It runs before and after the AI draft: it can raise a
// ticket's priority, mark it sensitive and ask for an owner alert, but never lower anything.

import { ANGRY, HIGH_MAIN, HIGH_PORT, IMMEDIATE_MAIN, IMMEDIATE_PORT, INTENTS, MANAGER, WEAK_DAMAGE, WEAK_OMISSION, type Rule } from "./tables";
import { bound, dropBoilerplate, foldQuotes, isExclaiming, isShouting, looksLikeSpam, shouldDraft, unquoted } from "./text";

export type Severity = "low" | "normal" | "high" | "critical";
export const SEVERITY_RANK: Record<Severity, number> = { low: 0, normal: 1, high: 2, critical: 3 };
export const maxSeverity = (a: Severity, b: Severity): Severity => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

export interface Classification {
  priority: Severity;
  sensitive: boolean;
  notifyOwner: boolean;
  shouldDraft: boolean;
  reason: string;
  matched: string[];
}

const compile = (rules: Rule[]) => rules.map((r) => new RegExp(r.pattern));
const T = {
  immediateMain: compile(IMMEDIATE_MAIN),
  immediatePort: compile(IMMEDIATE_PORT),
  weakDamage: compile(WEAK_DAMAGE),
  weakOmission: compile(WEAK_OMISSION),
  highMain: compile(HIGH_MAIN),
  highPort: compile(HIGH_PORT),
  manager: compile(MANAGER),
  angry: compile(ANGRY),
};
const SENSITIVE_INTENTS = new Set<string>(INTENTS.sensitive);
const HIGH_INTENTS = new Set<string>(INTENTS.high);
const HIGH_SENSITIVE_INTENTS = new Set<string>(INTENTS.high_sensitive);

const TRADE_ENQUIRY =
  /\b(wholesale|stockist|stock\s+your|stocking\s+your|trade\s+(?:account|price|pricing|enquiry|inquiry)|reseller|retail\s+account|bulk\s+order|collab|collaboration|brand\s+partnership|press\s+(?:sample|enquiry|inquiry|pack)|pr\s+(?:sample|enquiry|inquiry)|influencer|gifting\s+opportunity|media\s+pack)\b/i;
const ESCALATE = /\bescalate\s+(?:this|my)\b/i;
const ESCALATE_NEGATED = /\b(?:do\s?n'?t|do\s+not|no\s+need\s+to|not?\s+need|rather\s+not|please\s+do\s?n'?t)\s+(?:\w+\s+){0,2}escalate\b/i;
const FOLLOWUP = /(following\s+up|follow\s?up|still\s+(no|waiting)|yet\s+again|any\s+(update|response|reply|answer)|(2nd|3rd|second|third|fourth)\s+(time|attempt|message|email|follow))/i;
const HIGH_SENSITIVE =
  /\b(final\s+sale|change\s+(?:my\s+)?(?:shipping\s+)?address|wrong\s+address|update\s+(?:my\s+)?address|new\s+address|cancel(?:lation)?(?:\s+(?:my\s+)?(?:order|item|purchase))?|(?:has\s?n'?t|has\s+not|have\s+not|have\s?n'?t)\s+(?:arrived|turned\s+up|shown\s+up)|still\s+(?:has\s?n'?t|have\s?n'?t|not)\s+(?:arrived|come|received)|nothing\s+(?:has\s+|had\s+)?(?:arrived|come|turned\s+up|showed\s+up|been\s+delivered)|not\s+(?:been\s+)?delivered)\b/i;
const ORDER_CONTEXT =
  /\b(arrived|delivered|delivery|received|came\s+(?:in|today|yesterday)|parcel|parcels|package|packages|shipment|the\s+box|my\s+box|in\s+the\s+box|tracking|courier|dispatched|my\s+(?:order|purchase|item|items|delivery|parcel|package)|order[\s#]*\d|#\s*\d{3,})\b/i;
const BROWSING =
  /\b(can\s+i|could\s+i|do\s+you|does\s+the|does\s+it|is\s+there|are\s+there|am\s+i|how\s+do\s+i|how\s+can\s+i|how\s+to|how\s+would\s+i|what'?s?\s+the\s+best\s+way|any\s+tips|is\s+it\s+possible|would\s+it\s+be|can\s+you|could\s+you|would\s+you|will\s+you|do\s+i\s+need|where\s+do\s+i|what\s+do\s+i|which\s+(?:size|one|colour|color)|is\s+(?:the|this|that|it)\b|are\s+(?:the|these|those|they)\b|was\s+(?:the|this|that|it)\b|were\s+(?:the|these|those|they)\b|did\s+(?:the|this|that|it|you|they)\b)/i;
const PROBLEM =
  /\b((?:arrived|came|turned\s+up|delivered|showed\s+up)\s+(?:(?:completely|totally|badly|slightly|already|all|absolutely)\s+)?(?:ripped|stained|torn|damaged|open|soaked|filthy|dirty)|(?:a|an|the|one|another)\s+(?:ripped|stained|torn|damaged)\s+\w|(?:tracking|courier|carrier|parcel|package)\s+(?:has\s?n'?t|have\s?n'?t|has\s+not|is\s+stuck|stopped|shows\s+nothing|says\s+nothing|never|is\s+lost|went\s+missing|has\s+vanished)|no\s+tracking|tracking\s+number\s+does\s?n'?t|still\s+waiting|still\s+not|no\s+update|has\s?n'?t\s+moved|has\s+not\s+moved|where\s+is|where\s+are|chasing|chase\s+this|follow(?:ing)?\s?up|never\s+(?:came|arrived|turned\s+up)|why\b|still\s+(?:has\s?n'?t|have\s?n'?t|no|nothing)|(?:waiting|waited)\s+(?:for\s+)?(?:over\s+)?(?:(?:\d+|a|two|three)\s*)?(?:days?|weeks?|months?)|been\s+(?:over\s+)?(?:\d+|two|three|four)\s*(?:days?|weeks?|months?))/i;
const SHRINKAGE = /\b(?:i|we)(?:'ve|\s+have)?\s+(?:washed|laundered)\b[^.!?\n]{0,80}?\b(?:shrank|shrunk)\b|\b(?:shrank|shrunk)\b[^.!?\n]{0,40}?\b(?:after|following|since|in)\s+(?:the\s+)?(?:first\s+)?(?:wash(?:ed|ing)?|launder\w*)\b/i;
const SHRINKAGE_NOT = /\b(?:not|never|n't|if|whether|will|would|could|may|might)\b[^.!?\n]{0,40}\b(?:shrank|shrunk|shrink)\b/i;
const COLOR_MISMATCH = /\b(?:is|are|was|were|looks?|seems?|appears?|it's|they're)\s+(?:way|much|far|noticeably|significantly|considerably|a\s+lot|so\s+much)\s+(?:darker|lighter)\s+than\b.{0,60}\b(?:photos?|pictures?|images?|listing|product\s+page)\b/i;
// Routine service wording that would otherwise look like a complaint
const BROKEN_PORTAL = /\b(?:broken\s+(?:gift[ -]return\s+|return\s+)?portal|(?:gift[ -]return\s+|return\s+)?portal\s+(?:is|seems|appears)\s+broken)\b/gi;

function findAll(text: string, patterns: RegExp[]) {
  const found: string[] = [];
  for (const re of patterns) {
    const m = re.exec(text);
    const hit = m?.[0].split(/\s+/).join(" ");
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found;
}

const merge = (into: string[], more: string[]) => {
  for (const x of more) if (!into.includes(x)) into.push(x);
  return into;
};

export function classify(input: {
  subject: string;
  /** The customer's latest message */
  message: string;
  intents?: string[];
  /** A KB article used for this ticket is sensitive */
  kbSensitive?: boolean;
  orderTotal?: number | null;
}): Classification {
  const rawSubject = input.subject ?? "";
  const rawMessage = input.message ?? "";
  const latest = unquoted(rawMessage);
  const gate = shouldDraft(latest, rawSubject);
  if ((rawMessage.trim() && !latest) || !gate.ok) {
    return { priority: "normal", sensitive: false, notifyOwner: false, shouldDraft: false, reason: gate.reason ? `No new request (${gate.reason})` : "No new request", matched: [] };
  }
  if (looksLikeSpam(rawSubject, latest)) {
    return { priority: "normal", sensitive: false, notifyOwner: false, shouldDraft: false, reason: "Looks like spam (no store question)", matched: [] };
  }
  const subject = rawSubject.replace(BROKEN_PORTAL, "return portal unavailable");
  const message = rawMessage.replace(BROKEN_PORTAL, "return portal unavailable");
  const mainViews = [`${subject} ${message}`.toLowerCase()];
  const folded = foldQuotes(mainViews[0]);
  if (folded !== mainViews[0]) mainViews.push(folded);
  const normalizedMessage = foldQuotes(bound(message));
  const combined = `${foldQuotes(bound(subject)).toLowerCase()} ${dropBoilerplate(normalizedMessage.toLowerCase())}`;
  const intents = new Set((input.intents ?? []).map((i) => i.toLowerCase()));
  const exclaiming = isExclaiming(normalizedMessage);
  const shouting = isShouting(normalizedMessage);

  // ---- immediate (sensitive) ----
  const immediate = mainViews.reduce<string[]>((acc, v) => merge(acc, findAll(v, T.immediateMain)), []);
  merge(immediate, findAll(combined, T.immediatePort));
  const weak: string[] = [];
  if (ORDER_CONTEXT.test(combined)) {
    const browsing = BROWSING.test(combined) && !PROBLEM.test(combined);
    if (!browsing) merge(weak, [...findAll(combined, T.weakDamage), ...findAll(combined, T.weakOmission)]);
  }
  merge(immediate, weak);
  const manager = TRADE_ENQUIRY.test(combined) ? [] : findAll(combined, T.manager);
  if (ESCALATE.test(combined) && !ESCALATE_NEGATED.test(combined)) manager.push("escalate this");
  const angry = mainViews.reduce<string[]>((acc, v) => merge(acc, findAll(v, T.angry)), []);
  const angryHits = angry.length + Number(exclaiming) + Number(shouting) + Number(manager.length > 0);
  const sensitiveIntent = [...intents].some((i) => SENSITIVE_INTENTS.has(i));

  if (immediate.length || manager.length || sensitiveIntent || input.kbSensitive) {
    const reasons: string[] = [];
    const matched = [...immediate];
    if (immediate.length) reasons.push(`keyword match (${immediate.length} sensitive keywords)`);
    if (weak.length) reasons.push(`contextual match (${weak.join(", ")} + order/delivery context)`);
    if (manager.length) {
      reasons.push(`manager/escalation demand (${manager.join(", ")})`);
      merge(matched, manager);
    }
    if (sensitiveIntent) reasons.push("sensitive intent");
    if (input.kbSensitive) reasons.push("knowledge base marks the topic sensitive");
    if (exclaiming) {
      reasons.push("excessive exclamation (!!!)");
      matched.push("!!!");
    }
    if (shouting) {
      reasons.push("shouting (all caps)");
      matched.push("ALL CAPS");
    }
    if (angryHits >= 2) {
      reasons.push(`angry customer (${angryHits} signals)`);
      merge(matched, angry);
    }
    if ((input.orderTotal ?? 0) > 200 && immediate.length) reasons.push(`high order value ($${Number(input.orderTotal).toFixed(2)})`);
    return { priority: "critical", sensitive: true, notifyOwner: true, shouldDraft: true, reason: reasons.join("; "), matched };
  }

  // ---- high (urgent) ----
  const high = mainViews.reduce<string[]>((acc, v) => merge(acc, findAll(v, T.highMain)), []);
  merge(high, findAll(combined, T.highPort));
  const highIntent = [...intents].some((i) => HIGH_INTENTS.has(i));
  const followup = mainViews.map((v) => FOLLOWUP.exec(v)).find(Boolean);
  const latestNormalized = foldQuotes(latest);
  const shrinkage = SHRINKAGE.exec(latestNormalized);
  const shrank = shrinkage && !SHRINKAGE_NOT.test(shrinkage[0]) ? shrinkage : null;
  const colorMismatch = COLOR_MISMATCH.exec(latestNormalized);
  if (high.length || highIntent || followup || exclaiming || shouting || shrank || colorMismatch) {
    const sensitive =
      [...intents].some((i) => HIGH_SENSITIVE_INTENTS.has(i)) || mainViews.some((v) => HIGH_SENSITIVE.test(v)) || !!shrank || !!colorMismatch;
    const reasons: string[] = [];
    const matched = [...high];
    if (high.length) reasons.push(`keyword match (${high.length} urgent keywords)`);
    if (highIntent) reasons.push("urgent intent");
    if (followup) {
      reasons.push("follow-up");
      matched.push(followup[0].split(/\s+/).join(" "));
    }
    if (shrank) {
      reasons.push("reported shrinkage after washing");
      matched.push(shrank[0]);
    }
    if (colorMismatch) {
      reasons.push("item differs from the listing photos");
      matched.push(colorMismatch[0]);
    }
    if (exclaiming) {
      reasons.push("excessive exclamation (!!!)");
      matched.push("!!!");
    }
    if (shouting) {
      reasons.push("shouting (all caps)");
      matched.push("ALL CAPS");
    }
    return { priority: "high", sensitive, notifyOwner: true, shouldDraft: true, reason: reasons.join("; "), matched };
  }

  return { priority: "normal", sensitive: false, notifyOwner: false, shouldDraft: true, reason: "no sensitive or urgent signals", matched: [] };
}
