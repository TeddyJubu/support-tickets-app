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

const VERBS = "switch|change|cancel|replace|ship|refund|credit|issue|process|create|invoice|prioritize|hold|flag|mark|escalate|forward|pass (?:this |it |that |your \\w+ )?(?:along|on)|contact|notify|remove|add|apply|arrange|leave|correct|resolve";
const PARTICIPLES =
  "switched|updated|changed|cancelled|canceled|replaced|shipped|sent|issued|processed|refunded|credited|created|prioritized|held|flagged|marked|escalated|forwarded|passed|contacted|notified|removed|added|applied|arranged|left|corrected|resolved";
// After "we can": only money and order changes count as a promise ("we can refund you")
const CAN_VERBS = "refund|credit|issue|process|cancel|replace|invoice|prioritize|hold|remove|apply|arrange|resolve|change your order|change the order";
// Past-tense claims of a store action ("we processed / refunded / cancelled")
const ORDER_PAST = "flagged|marked|escalated|forwarded|passed (?:this |it |that |your \\w+ )?(?:along|on)|processed|refunded|credited|issued|cancelled|canceled|replaced|shipped|sent out|changed|updated|corrected|resolved|applied|arranged|removed|added";
const OBJECTS = "label|refund|credit|replacement|invoice|warehouse|order|shipment|package|address";
const UPDATE = "update(?!\\s+(?:you|yourself|us|the\\s+customer)\\b)";
const WHO = "(?:we|i|our team|the team|the store|store|warehouse|a human|human)";
// First-person operational claims: the AI can't refund, cancel, ship or change anything
const ACTION_CLAIM = new RegExp(
  [
    // "we can ship to Canada" states policy; "we will refund / have shipped" claims an action
    `\\b${WHO}\\s+(?:will|would|have|has|already|just|are going to|is going to)\\s+(?:${VERBS}|${UPDATE})\\b`,
    `\\b${WHO}\\s+(?:can|could)\\s+(?:${CAN_VERBS})\\b`,
    `\\b(?:we|i)\\s*['’](?:re|m) going to\\s+(?:${VERBS}|${UPDATE})\\b`,
    `\\b(?:we|i)\\s*['’](?:ll|ve)\\s+(?:${VERBS}|${UPDATE})\\b`,
    `\\b(?:we|i)\\s*['’]ll\\s+(?:get|have)\\s+(?:it|this|that|your(?:\\s+\\w+){0,3}|the(?:\\s+\\w+){0,3})\\s+(?:${PARTICIPLES})\\b`,
    `\\b(?:we|i)\\s*['’]ll\\s+take\\s+care\\s+of\\s+(?:it|this|that|your\\s+order)\\b`,
    `\\b(?:we|i|our team|the team)\\s+(?:have|has|just|already)\\s+(?:(?:also|now|just|already)\\s+)?(?:${PARTICIPLES})\\b`,
    `\\b(?:we|i)\\s*['\u2019]ve\\s+(?:(?:just|already|also|now)\\s+)?(?:${PARTICIPLES})\\b`,
    // Simple past: "we processed your refund", "I cancelled the order"
    `\\b(?:we|i|our team|the team)\\s+(?:just\\s+|already\\s+)?(?:${ORDER_PAST})\\b`,
    `\\b${WHO}\\s+(?:will|would|are going to|is going to)\\s+send\\b[^.!?\\n]{0,80}\\b(?:prepaid\\s+|return\\s+)?(?:${OBJECTS})\\b(?![^.!?\\n]{0,80}\\b(?:once|after|when|if)\\b)`,
    `\\b(?:your\\s+)?(?:refund|replacement|exchange|cancellation)\\s+(?:has\\s+been|is\\s+being|was)\\s+(?:issued|processed|approved|sent|completed)\\b`,
    // Hand-offs the AI can't make: "I'm escalating this", "this has been marked urgent / passed on"
    `\\b(?:we|i)\\s*(?:['’]re|['’]m|\\s+am|\\s+are)\\s+(?:escalating|forwarding|flagging|marking|passing)\\b`,
    `\\b(?:this|it|that|your\\s+(?:request|order|ticket|case|message|issue))\\s+(?:has\\s+been|is\\s+being|was)\\s+(?:escalated|forwarded|flagged|marked|passed)\\b`,
    // Promised results: "you can expect a corrected invoice", "you'll receive a replacement"
    `\\byou\\s*(?:['’]ll|\\s+will|\\s+can|\\s+should)\\s+(?:expect|receive|get|be\\s+getting)\\s+(?:a|an|your)\\s+(?:corrected|revised|updated|new|replacement|reissued)\\b(?![^.!?\\n]{0,80}\\b(?:once|after|when|if)\\b)`,
    // Reversed or roundabout promises: "a free replacement is exactly what you can expect",
    // "we'll pull up your order ... and send a new zipper pull"
    `\\b(?:free\\s+)?(?:replacement|refund|exchange|store\\s+credit|new\\s+\\w+)\\s+is\\s+(?:exactly\\s+)?what\\s+you\\s+(?:can|will|should)\\s+(?:expect|get|receive)\\b`,
    `\\b(?:we|i)\\s*['’]ll\\b[^.!?\\n]{0,120}?\\bsend\\s+(?:you\\s+)?(?:either\\s+)?(?:a|an)\\s+(?:new|replacement|free)\\b(?![^.!?\\n]{0,80}\\b(?:once|after|when|if)\\b)`,
    // Claims about the ticket the AI can't see or change: "the photos have been added to the ticket"
    `\\b(?:been|were|was)\\s+(?:added|attached|saved|logged|uploaded)\\s+to\\s+(?:the|your)\\s+(?:ticket|case|file|order|account|notes?|records?)\\b`,
  ].join("|"),
  "i",
);

// The email goes out from a person on the team: no talk about the ticket system or the AI's
// own access ("it's in this ticket", "whoever picks it up", "from my side")
const INTERNAL_TALK = new RegExp(
  [
    `\\b(?:in|on|to)\\s+(?:this|the|your)\\s+(?:ticket|case\\s+notes|internal\\s+notes)\\b`,
    `\\bwhoever\\s+(?:picks|takes|handles|reads|gets|helps|looks|works|answers|is\\s+on)\\b`,
    // "this ticket's history", "the ticket notes", "your ticket number": the helpdesk system itself
    `\\b(?:this|the|your)\\s+ticket(?:['’]s|\\s+(?:history|notes?|thread|record|log|number|details))\\b`,
    `\\bfrom\\s+my\\s+(?:side|end)\\b`,
    `\\bi\\s+(?:don['’]t|do\\s+not)\\s+have\\s+access\\b`,
    `\\bi\\s*(?:can['’]t|cannot|am\\s+not\\s+able\\s+to|['’]m\\s+not\\s+able\\s+to|am\\s+unable\\s+to)\\s+(?:see|access|view|look\\s+up|pull\\s+up)\\b`,
    // "I can't confirm ... from here", "I can't change it myself": its own limits, not the team's
    `\\bi\\s*(?:can['’]t|cannot|am\\s+not\\s+able\\s+to|['’]m\\s+not\\s+able\\s+to|am\\s+unable\\s+to)\\s+(?:confirm|verify|check|redirect|change|find)\\b[^.!?\\n]{0,80}\\b(?:from\\s+here|myself|on\\s+my\\s+own)\\b`,
  ].join("|"),
  "i",
);
export const findInternalTalk = (text: string) => INTERNAL_TALK.exec(text)?.[0] ?? null;

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
  // A body repeated back-to-back inside one paragraph ("A B A B" → "A B")
  const collapsed = kept.map((b) => {
    const sentences = b.match(/[^.!?]+[.!?]+(?:["')\]]+)?\s*|[^.!?]+$/g) ?? [b];
    const n = sentences.length;
    if (n >= 2 && n % 2 === 0) {
      const half = sentences.slice(0, n / 2).join("");
      if (norm(half).length >= 40 && norm(half) === norm(sentences.slice(n / 2).join(""))) {
        removed = true;
        return half.trimEnd();
      }
    }
    return b;
  });
  return { text: collapsed.join("\n\n"), removed };
}

function shorten(text: string, max: number) {
  const ends = [...text.matchAll(/[.!?](?:["')\]]+)?(?=\s|$)/g)].filter(
    (m) => !/\b(?:e\.g|i\.e|u\.s|u\.k|mr|mrs|ms|dr|vs|etc)\.$/i.test(text.slice(Math.max(0, m.index! - 5), m.index! + 1)),
  );
  // Greeting and sign-off lines ("Hi Dana,", "Acme Support") don't end with . ! ?
  if (ends.length <= max) return { text, tail: "" };
  const cut = ends[max - 1].index! + ends[max - 1][0].length;
  const tail = text.slice(cut).trim();
  const signOff = /\n\s*(?:warmly|best|thanks|thank you|kind regards|regards|xo|love)[^\n]{0,30},?\s*\n[^\n]{0,60}$/i.exec(text);
  return { text: `${text.slice(0, cut).trim()}${signOff ? `\n\n${signOff[0].trim()}` : ""}`, tail };
}

// Drafts go out as plain-text email: markdown would show as literal asterisks and hashes
function stripMarkdown(text: string) {
  const out = text
    .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_, a, b) => a ?? b)
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?;:)]|$)/gm, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^(\s*)[*•]\s+/gm, "$1- ")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/`([^`\n]+)`/g, "$1");
  return { text: out, changed: out !== text };
}

export function cleanDraft(raw: string, sensitive: boolean): CleanResult {
  let text = (raw ?? "").replace(/\r/g, "").trim();
  const notes: string[] = [];
  const md = stripMarkdown(text);
  if (md.changed) {
    text = md.text;
    notes.push("removed markdown formatting");
  }
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
  const internal = INTERNAL_TALK.exec(text);
  if (internal) {
    return {
      text: "",
      suppressed: true,
      notes: [...notes, `held back: it talked about the ticket or its own access ("${internal[0]}")`],
      removed: [...removed, text].join("\n\n"),
    };
  }
  return { text, suppressed: false, notes, removed: removed.join("\n") };
}

export const findActionClaim = (text: string) => ACTION_CLAIM.exec(text)?.[0] ?? null;

// The sign-off is always the configured sender name: the model sometimes invents one
// ("Cute Little Things") or picks up another brand from the articles
const SIGN_NAME = /\b(?:support|team|customer\s+care|things|bebe|store|shop)\b/i;
export function fixSignOff(text: string, senderName: string) {
  const lines = text.trimEnd().split("\n");
  const last = lines.at(-1)!.trim();
  const before = lines.length > 1 ? lines.at(-2)!.trim() : "";
  // "Warmly," / "תודה על הסבלנות," with no name after it
  if (/,$/.test(last) && last.length <= 40) return { text: `${lines.join("\n")}\n${senderName}`, changed: true };
  const nameLine = last.length <= 50 && !/[.!?:]$/.test(last) && (/,$/.test(before) || SIGN_NAME.test(last));
  if (nameLine) {
    if (last === senderName) return { text: lines.join("\n"), changed: false };
    // A two-line name block ("Cute Things Team" / "Cute Things") goes as a whole
    let keep = lines.length - 1;
    while (keep > 0 && lines[keep - 1].trim().length <= 50 && !/[.!?:,]$/.test(lines[keep - 1].trim()) && SIGN_NAME.test(lines[keep - 1])) keep--;
    return { text: [...lines.slice(0, keep), senderName].join("\n"), changed: true };
  }
  return { text: `${lines.join("\n")}\n\n${senderName}`, changed: true };
}