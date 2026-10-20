// Text views used by the classifier and the "nothing to answer" gate, ported from the
// Shopify helpdesk (processor/classifier/views.py, draft_cleaner.should_draft).

import { CAPS } from "./tables";

const MAX_SCAN = 60_000;

export const foldQuotes = (t: string) =>
  t.replace(/[’‘ʼ´]/g, "'").replace(/[“”]/g, '"');

export function bound(text: string) {
  if (text.length <= MAX_SCAN) return text;
  const head = Math.floor((MAX_SCAN * 3) / 4);
  return `${text.slice(0, head)} zqxtruncatedzqx ${text.slice(-(MAX_SCAN - head - 20))}`;
}

const QUOTE_LINE = /^\s*(?:>|\|)/;
const QUOTE_HEADER =
  /^\s*(?:on\s.{0,200}\d.{0,160}\swrote:\s*$|.{0,120}<[^>@\s]{1,64}@[^>\s]{1,64}>\s+wrote:\s*$|-{2,}\s*(?:original message|forwarded message)[\s-]*$|begin\s+forwarded\s+message:\s*$|_{5,}\s*$|(?:from|sent|to|subject):\s.{0,200}$)/i;

/** The customer's new words: quoted history and reply headers removed */
export function unquoted(message: string) {
  const kept: string[] = [];
  let seen = false;
  for (const line of (message ?? "").split(/\r?\n/)) {
    if (QUOTE_LINE.test(line)) continue;
    if (QUOTE_HEADER.test(line)) {
      if (seen) break;
      continue;
    }
    kept.push(line);
    if (line.trim()) seen = true;
  }
  return kept.join("\n").trim();
}

const STORE_BOILERPLATE =
  /(reply\s+to\s+this\s+email|do\s+not\s+reply|unsubscribe|view\s+this\s+email|this\s+email\s+was\s+sent|thanks\s+for\s+(reaching\s+out|getting\s+in\s+touch|your\s+patience)|we\s+(are|'re)\s+(looking\s+into|sorry\s+to\s+hear|so\s+sorry)|we\s+will\s+(get\s+back|be\s+in\s+touch|look\s+into)|working\s+days|%\s*off|flash\s+sale|shop\s+now|(just|simply|hit)\s+reply|let\s+us\s+know|get\s+in\s+touch\s+with\s+us|our\s+returns?\s+policy|terms\s+and\s+conditions|all\s+rights\s+reserved|you\s+are\s+receiving\s+this|our\s+(customer\s+)?(care|support)\s+team)/i;

export function dropBoilerplate(text: string) {
  const kept = (text ?? "").split(/\n\s*\n/).filter((p) => !STORE_BOILERPLATE.test(p));
  return kept.join("\n\n").trim() || text || "";
}

const fresh = (message: string) => dropBoilerplate(unquoted(message)) || message || "";

const POSITIVE =
  /\b(thank|thanks|thankyou|thx|love|loved|loving|adorable|perfect|beautiful|gorgeous|cute|amazing|wonderful|excellent|obsessed|delighted|thrilled|pleased|happy|brilliant|fantastic|lovely|great|awesome|best|nice|super|fab|fabulous|appreciate|appreciated|recommend|quick|fast|impressed|worth|favourite|favorite|soft|softer|softest|comfy|cosy|cozy|snug|cutest|recommended|glad|happier|happiest|adore|adored|stunning|well\s+spent|every\s+penny|chuffed|spot\s+on|top\s+notch|quality|over\s+the\s+moon|well\s+made|cannot\s+fault)\b/i;
const NEGATIVE =
  /\b(never\s+(?:received|receive|arrived|arrive|came|come|got|get|turned\s+up|delivered|shipped|sent|replied|responded|answered|heard|resolved|refunded|shopping|buying|ordering)|never\s+(?:\w+\s+){0,3}again|refund|damaged|broken|wrong|missing|late|angry|furious|unacceptable|terrible|awful|worst|horrible|disappointed|disappointing|ridiculous|useless|rubbish|scam|fraud|cancel|complaint|complain|nobody|noone|ignored|ignoring|refused|refusing|disgusting|disgrace|appalling|pathetic|unhappy|fed\s+up|sick\s+of|had\s+enough|waste|wasted|poor\s+quality|bad\s+quality|falling\s+apart|shocking|disgraceful|frustrat\w+|livid|fuming|appalled|outrage\w*|no\s+(?:reply|response|answer|word|update)|chasing|joke|shambles|third\s+time|3rd\s+time)\b/i;

const STOP = new Set(CAPS.stopwords);
const ANCHORS = new Set(CAPS.anchors);
const GRAMMAR = new Set(CAPS.grammar);
const COMPLAINT = new Set(CAPS.complaint_verbs);
const HARD = new Set(CAPS.hard_anchors);

export function isShouting(message: string) {
  const text = fresh(message);
  const allCaps = text.match(/\b[A-Z]{2,}\b/g) ?? [];
  const allWords = text.match(/\b[A-Za-z]{2,}\b/g) ?? [];
  if (!allWords.length) return false;
  const positiveOnly = POSITIVE.test(text) && !NEGATIVE.test(text);
  const caps = allCaps.filter((w) => !STOP.has(w));
  const words = allWords.filter((w) => !STOP.has(w.toUpperCase()));
  if (caps.length >= 2 && words.length && caps.length / words.length >= 0.6 && caps.some((w) => ANCHORS.has(w))) {
    if (!positiveOnly || caps.some((w) => HARD.has(w))) return true;
  }
  return (
    !positiveOnly &&
    allCaps.length >= 8 &&
    allCaps.length / allWords.length >= 0.9 &&
    allCaps.filter((w) => GRAMMAR.has(w)).length >= 2 &&
    allCaps.some((w) => COMPLAINT.has(w))
  );
}

export function isExclaiming(message: string) {
  const text = fresh(message);
  if (!/!{3,}/.test(text)) return false;
  return !(POSITIVE.test(text) && !NEGATIVE.test(text));
}

// ---------- nothing-to-answer gate ----------

const ACK_ANCHORS = new Set(["thanks", "thank", "thanx", "thx", "ty", "tysm", "cheers", "appreciate", "appreciated", "appreciation", "ok", "okay", "kk", "noted", "understood", "received", "got", "perfect", "great", "awesome", "excellent", "brilliant", "amazing"]);
const ACK_FILLER = new Set(["a", "again", "all", "and", "at", "bye", "dear", "everyone", "folks", "for", "from", "guys", "hello", "hey", "hi", "in", "it", "its", "lot", "lots", "love", "loved", "lovely", "me", "much", "my", "night", "nice", "of", "oh", "on", "regards", "so", "super", "team", "that", "the", "this", "to", "too", "u", "very", "we", "weekend", "with", "you", "your", "yours", "x", "xx", "xxx"]);
const GRATITUDE = new Set(["thanks", "thank", "thanx", "thx", "ty", "tysm", "cheers", "appreciated", "appreciation"]);
// Words that can answer a question ("shall I cancel it?" "ok") are always content
const DECISION = new Set(["ok", "okay", "kk", "noted", "understood", "received", "got"]);
const SAFE_EMOJI = ["\u{1F44D}", "\u{1F64F}", "❤", "\u{1F60A}", "\u{1F642}", "\u{1F600}", "\u{1F601}", "\u{1F970}", "\u{1F60D}", "\u{1F44C}", "✅", "\u{1F389}", "\u{1F495}", "\u{1F49B}", "\u{1F44F}", "\u{1F929}", "⭐", "\u{1F31F}", "\u{1F338}", "\u{1F49C}"];
const INERT = " \t\r\n.,~-–—…'\"()[]:;*_/\\";
const SAD_EMOTICON = /[:;=8][-'~^]?(?:[([|\\<]|\/(?!\/))/;
const HAPPY_EMOTICON = /[:;=8][-'~^]?[)\]>DdPpOo3*]+/g;
const SUBJECT_NOISE =
  /^\s*((re|fw|fwd|aw|sv)\s*:\s*)+|\border[\s#]*\d+|#\s*\d+|\b(no\s+subject|message\s+from\s+(the\s+)?contact\s+form|contact\s+form|order\s+confirmation|your\s+order|buttons\s+bebe|customer\s+(service|support)|support\s+request|new\s+message|website\s+enquiry|enquiry|update)\b|\b(your|our|my|the|a|an|order|orders|ticket|case|ref|reference)\b/gi;

function stripDecoration(text: string) {
  let t = text.replace(/[\u{1F3FB}-\u{1F3FF}︎️​‌‍﻿]/gu, "");
  for (const e of SAFE_EMOJI) t = t.split(e).join("");
  return t.replace(HAPPY_EMOTICON, " ");
}

function carriesNoContent(value: string) {
  const text = stripDecoration(value);
  if (!text.trim()) return true;
  if (text.includes("?") || SAD_EMOTICON.test(text)) return false;
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const residue = text.replace(/[\p{L}\p{N}_]+/gu, " ");
  const inert = INERT + (tokens.length ? "!" : "");
  if ([...residue].some((ch) => !inert.includes(ch) && !/\s/.test(ch))) return false;
  if (!tokens.length) return true;
  if (!(tokens.every((t) => ACK_ANCHORS.has(t) || ACK_FILLER.has(t)) && tokens.some((t) => ACK_ANCHORS.has(t)))) return false;
  if (tokens.some((t) => DECISION.has(t))) return false;
  if (tokens.length <= 2 && !tokens.some((t) => GRATITUDE.has(t))) return false;
  return true;
}

/** False only when there is genuinely nothing to answer ("thanks!", "👍") */
export function shouldDraft(message: string, subject = ""): { ok: boolean; reason?: string } {
  const m = (message ?? "").split(/\s+/).filter(Boolean).join(" ");
  const s = (subject ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (m.length > 20_000 || s.length > 2_000) return { ok: true };
  if (!carriesNoContent(m)) return { ok: true };
  if (m.trim()) return { ok: false, reason: "no question to answer (thanks/acknowledgement only)" };
  if (!carriesNoContent(s.replace(SUBJECT_NOISE, " "))) return { ok: true };
  return { ok: false, reason: stripDecoration(`${s} ${m}`).trim() ? "no question to answer (thanks/acknowledgement only)" : "empty message" };
}
