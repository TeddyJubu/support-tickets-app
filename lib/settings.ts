// Store settings for this install (.env.local). Each store runs its own copy of the
// helpdesk, so its name, support address and AI instructions are read here, never hardcoded.
// Read at request time: one build works with any .env.local (restart after changing it).

const env = (key: string) => process.env[key]?.trim() || undefined;

export interface StoreSettings {
  /** Store name shown in the UI and the AI prompt */
  name: string;
  /** Address customers email; replies go out from it */
  supportEmail: string;
  /** Display name on outbound email and the AI's draft signature */
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

// From header for agent replies; OUTBOUND_EMAIL_FROM overrides it entirely
export function outboundFrom(store = storeSettings()) {
  return env("OUTBOUND_EMAIL_FROM") ?? `${store.senderName} <${store.supportEmail}>`;
}

// The copilot's instructions. The browser only adds the open ticket's context (app/api/chat/route.ts).
export function copilotPrompt(store = storeSettings()) {
  const description = env("STORE_DESCRIPTION") ?? "a small online baby and children's store";
  return `You are an AI assistant helping ${store.name}'s customer support agents (${description}).

**Data:**
The open ticket, its customer and their recent tickets are in your context. Tickets arrive by email to ${store.supportEmail} and include the message text. Store data (products, orders, customers) is not connected yet, so lookups may return nothing. Never invent order details, products or policies; say what you don't know.

**Response Style:**
Be concise by default. Tools display UI cards with full details, so don't repeat that data in your response. Keep it brief and actionable - elaborate only when the agent asks for more details.`;
}
