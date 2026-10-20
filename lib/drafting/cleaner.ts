// Last-mile draft cleanup, ported from the Shopify helpdesk's draft_cleaner.py.
// It can only shorten or suppress: strip model self-talk and internal notes, collapse
// repeated blocks, cap the length, and refuse drafts that promise actions the AI can't take.

const SELF_TALK = [
  "the response above was complete",
  "the (?:previous|prior) (?:response|reply|draft) (?:was|is) (?:already )?complete",
  "the above (?:response|reply|draft) ",
  "this (?:response|reply|draft) (?:above )?(?:is|was) (?:now )?complete",
  "i have (?:now )?(?:completed|finished) (?:the|this|my) (?:response|reply|draft)",
  "notes? (?:to|for) (?:the )?(?:reviewer|agent|human|staff)\\b",
  "internal\\b[:\\s]",
  "for internal use\\b",
  "confidence:\\s",
  "\\[?end of (?:the\\s+)?(?:response|reply|draft)\\]?",
  "(?:the\\s+)?(?:response|reply|draft)\\s+above\\s+(?:is|was)\\s+(?:already\\s+|now\\s+)?complete",
  "\\[?(?:draft|response|reply)\\s+complete\\b",
  "i(?:'ve| have)\\s+(?:completed|written|finished)\\s+(?:the|this|my)\\s+(?:response|reply|draft)",
  "agent[\\s-]note\\b",
  "\\(internal[:\\s]",
  "\\[?suggested(?:\\s+customer[- ]facing)?\\s+reply\\b",
  "\\[?recommended(?:\\s+customer[- ]facing)?\\s+(?:reply|handling)\\b",
  "\\[?action\\s+needed\\b",
  "\\[?policy\\s+basis\\b",
  "human\\s+review\\b",
  "\\[?no\\s+customer[- ]facing\\s+reply\\b",
  "\\[internal\\s+note\\b",
  "staff[_ ]next[_ ]step\\b",
  "missing[_ ]facts\\b",
  "as an ai\\b.*\\bi (?:cannot|can't|am unable)",
];
const SELF_TALK_LINE = new RegExp(`^[\\s>*#\\-]*(?:${SELF_TALK.join("|")})`, "i");

const VERBS = "switch|change|cancel|replace|ship|refund|credit|issue|process|create|invoice|prioritize|hold|flag|contact|notify|remove|add|apply|arrange|leave|correct|resolve";
const PARTICIPLES =
  "switched|updated|changed|cancelled|canceled|replaced|shipped|sent|issued|processed|refunded|credited|created|prioritized|held|flagged|contacted|notified|removed|added|applied|arranged|left|corrected|resolved";
const OBJECTS = "label|refund|credit|replacement|invoice|warehouse|order|shipment|package|address";
const UPDATE = "update(?!\\s+(?:you|yourself|us|the\\s+customer)\\b)";
const WHO = "(?:we|i|our team|the team|the store|store|warehouse|a human|human)";
// First-person operational claims: the AI can't refund, cancel, ship or change anything
const ACTION_CLAIM = new RegExp(
  [
    `\\b${WHO}\\s+(?:can|could|will|would|have|has|already|just|are going to|is going to)\\s+(?:${VERBS}|${UPDATE})\\b`,
    `\\b(?:we|i)\\s*['’](?:re|m) going to\\s+(?:${VERBS}|${UPDATE})\\b`,
    `\\b(?:we|i)\\s*['’](?:ll|ve)\\s+(?:${VERBS}|${UPDATE})\\b`,
    `\\b(?:we|i)\\s*['’]ll\\s+(?:get|have)\\s+(?:it|this|that|your(?:\\s+\\w+){0,3}|the(?:\\s+\\w+){0,3})\\s+(?:${PARTICIPLES})\\b`,
    `\\b(?:we|i)\\s*['’]ll\\s+take\\s+care\\s+of\\s+(?:it|this|that|your\\s+order)\\b`,
    `\\b(?:we|i|our team|the team)\\s+(?:have|has|just|already)\\s+(?:${PARTICIPLES})\\b`,
    `\\b(?:we|i)\\s*['\u2019]ve\\s+(?:just\\s+|already\\s+)?(?:${PARTICIPLES})\\b`,
    `\\b${WHO}\\s+(?:will|would|are going to|is going to)\\s+send\\b[^.!?\\n]{0,80}\\b(?:prepaid\\s+|return\\s+)?(?:${OBJECTS})\\b`,
    `\\b(?:your\\s+)?(?:refund|replacement|exchange|cancellation)\\s+(?:has\\s+been|is\\s+being|was)\\s+(?:issued|processed|approved|sent|completed)\\b`,
  ].join("|"),
  "i",
);

export const MAX_SENTENCES = { normal: 6, sensitive: 7 };

export interface CleanResult {
  text: string;
  /** true: nothing sendable is left; staff must write the reply */
  suppressed: boolean;
  notes: string[];
  /** removed self-talk / internal notes, shown to staff only */
  removed: string;
}

function cutSelfTalk(text: string) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => SELF_TALK_LINE.test(l));
  if (at < 0) return { text, cut: "" };
  return { text: lines.slice(0, at).join("\n"), cut: lines.slice(at).join("\n") };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function dedupe(text: string) {
  const blocks = text.split(/\n\s*\n/);
  const seen = new Set<string>();
  const kept: string[] = [];
  let removed = false;
  for (const b of blocks) {
    const key = norm(b);
    if (key.length >= 40 && seen.has(key)) {
      removed = true;
      continue;
    }
    seen.add(key);
    kept.push(b);
  }
  // A body repeated back-to-back inside one block ("A B A B")
  return { text: kept.join("\n\n"), removed };
}

function shorten(text: string, max: number) {
  const ends = [...text.matchAll(/[.!?](?:["')\]]+)?(?=\s|$)/g)].filter(
    (m) => !/\b(?:e\.g|i\.e|u\.s|u\.k|mr|mrs|ms|dr|vs|etc)\.$/i.test(text.slice(Math.max(0, m.index! - 5), m.index! + 1)),
  );
  // Greeting and sign-off lines ("Hi Dana,", "Buttons Bebe Support") don't end with . ! ?
  if (ends.length <= max) return { text, tail: "" };
  const cut = ends[max - 1].index! + ends[max - 1][0].length;
  const tail = text.slice(cut).trim();
  const signOff = /\n\s*(?:warmly|best|thanks|thank you|kind regards|regards|xo|love)[^\n]{0,30},?\s*\n[^\n]{0,60}$/i.exec(text);
  return { text: `${text.slice(0, cut).trim()}${signOff ? `\n\n${signOff[0].trim()}` : ""}`, tail };
}

export function cleanDraft(raw: string, sensitive: boolean): CleanResult {
  let text = (raw ?? "").replace(/\r/g, "").trim();
  const notes: string[] = [];
  const removed: string[] = [];
  if (!text) return { text: "", suppressed: true, notes: ["empty draft"], removed: "" };
  for (let i = 0; i < 4; i++) {
    const a = cutSelfTalk(text);
    if (a.cut) {
      removed.push(a.cut);
      if (!notes.includes("removed the AI's notes to itself")) notes.push("removed the AI's notes to itself");
    }
    const b = dedupe(a.text);
    if (b.removed && !notes.includes("removed a repeated paragraph")) notes.push("removed a repeated paragraph");
    text = b.text.trim();
    if (!a.cut && !b.removed) break;
  }
  if (!text) return { text: "", suppressed: true, notes: [...notes, "nothing left after cleaning"], removed: removed.join("\n") };
  const short = shorten(text, sensitive ? MAX_SENTENCES.sensitive : MAX_SENTENCES.normal);
  if (short.tail) {
    text = short.text;
    notes.push("shortened to the length limit");
    removed.push(short.tail);
  }
  const claim = ACTION_CLAIM.exec(text);
  if (claim) {
    return {
      text: "",
      suppressed: true,
      notes: [...notes, `held back: it promised an action the AI can't take ("${claim[0]}")`],
      removed: [...removed, text].join("\n\n"),
    };
  }
  return { text, suppressed: false, notes, removed: removed.join("\n") };
}

export const findActionClaim = (text: string) => ACTION_CLAIM.exec(text)?.[0] ?? null;
