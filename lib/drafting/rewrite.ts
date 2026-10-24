// "Edit reply with AI": staff give an instruction ("shorter", "mention store credit") and get
// back rewritten text only. One rewrite at a time per server process, bounded in time and
// length; the model never sees or uses tools here.

import { AiError, chatCompletion } from "../workers-ai";
import { cleanDraft, fixSignOff } from "./cleaner";
import { neutralize } from "./markers";
import { storeIntro, storeSettings } from "../settings";

const TIMEOUT_MS = 150_000;
let busy = false;

export class RewriteBusyError extends Error {}

export async function rewriteDraft(input: { text: string; instruction: string; sensitive?: boolean }) {
  if (busy) throw new RewriteBusyError("Another AI rewrite is running. Try again in a moment.");
  busy = true;
  try {
    const reply = await chatCompletion(
      [
        {
          role: "system",
          content: `You rewrite customer-support email drafts for ${storeIntro()} following a staff member's instruction. Return only the rewritten email, with no commentary, markers or quotes. Keep every fact from the draft unless the instruction changes it; don't add facts, prices, dates or promises. Never say the store did or will refund, cancel, ship, replace or change anything. Keep it warm and short, signed "${storeSettings().senderName}".`,
        },
        {
          role: "user",
          content: `Instruction from staff: ${neutralize(input.instruction).slice(0, 1000)}\n\nDraft:\n${neutralize(input.text).slice(0, 10_000)}`,
        },
      ],
      { maxTokens: 4000, timeoutMs: TIMEOUT_MS, temperature: 0.4 },
    );
    const cleaned = cleanDraft(reply.content ?? "", !!input.sensitive);
    if (cleaned.suppressed) {
      throw new AiError(cleaned.notes.at(-1) ?? "The rewrite wasn't usable", "invalid");
    }
    return { text: fixSignOff(cleaned.text, storeSettings().senderName).text, notes: cleaned.notes };
  } finally {
    busy = false;
  }
}
