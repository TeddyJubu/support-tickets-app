// Store settings for this install (.env.local). Each store runs its own copy of the
// helpdesk, so its name, support address and AI instructions are read here, never hardcoded.
// Read at request time: one build works with any .env.local (restart after changing it).

const env = (key: string) => process.env[key]?.trim() || undefined;

export interface StoreSettings {
  /** Store name shown in the UI and the AI prompts */
  name: string;
  /** Address customers email; replies go out from it */
  supportEmail: string;
  /** Display name on outbound email and the AI's sign-off */
  senderName: string;
}

export function storeSettings(): StoreSettings {
  const name = env("STORE_NAME") ?? "Cute Things";
  return {
    name,
    supportEmail: env("SUPPORT_EMAIL") ?? "support@teddyonfriday.com",
    senderName: env("SENDER_NAME") ?? `${name} Support`,
  };
}

/** "Cute Things (a small online baby and children's store)", for AI prompts */
export function storeIntro(store = storeSettings()) {
  return `${store.name} (${env("STORE_DESCRIPTION") ?? "a small online baby and children's store"})`;
}

// From header for staff replies; OUTBOUND_EMAIL_FROM overrides it entirely
export function outboundFrom(store = storeSettings()) {
  return env("OUTBOUND_EMAIL_FROM") ?? `${store.senderName} <${store.supportEmail}>`;
}

// The copilot's instructions. The browser only adds the open ticket's context (app/api/chat/route.ts).
export function copilotPrompt(store = storeSettings()) {
  return `You are an AI assistant helping the customer support agents of ${storeIntro(store)}.

**Data:**
The open ticket, its customer and their recent tickets are in your context. Inbox tickets include the full conversation (customers email ${store.supportEmail}); store data covers simulated customers only, so lookups for emailed customers may return nothing. Archived tickets come from a Gorgias export with subjects, tags, intents, timing and message counts but no message text. Never invent message content, order details or policies; say what you don't know.

**Store policy:** Before answering anything about policy, shipping, returns, refunds, sizing or products, call search_knowledge_base and base the answer on what it returns. Live notices override articles. Results marked sensitive (refunds, damage, cancellations, angry customers…) need a person to decide: draft, but say so. Use the other search tools for products, customers and past tickets.

**Response Style:**
Be concise by default. Tools display UI cards with full details, so don't repeat that data in your response. Keep it brief and actionable - elaborate only when the agent asks for more details.`;
}
