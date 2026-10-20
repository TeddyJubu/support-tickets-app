// Cloudflare Workers AI, used server-side by the KB index (embeddings) and the drafting
// worker (chat with tools). The browser copilot goes through app/api/chat instead.

export const DEFAULT_CHAT_MODEL = "@cf/zai-org/glm-5.3-flash";
export const EMBEDDING_MODEL = "@cf/baai/bge-m3"; // multilingual, 1024 dimensions

type Fetch = typeof fetch;
let transport: Fetch = (...args) => fetch(...args);

/** Tests replace the network with a fake */
export function setAiFetch(fn: Fetch | null) {
  transport = fn ?? ((...args) => fetch(...args));
}

export function aiConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  return accountId && token
    ? { accountId, token, model: process.env.CF_MODEL || DEFAULT_CHAT_MODEL }
    : null;
}

export class AiError extends Error {
  /** auth: bad credentials (don't retry); transient: timeout, 429, 5xx (retry later); invalid: bad request/response */
  readonly kind: "auth" | "transient" | "invalid";
  constructor(message: string, kind: "auth" | "transient" | "invalid") {
    super(message);
    this.kind = kind;
  }
}

async function post(path: string, body: unknown, timeoutMs: number) {
  const config = aiConfig();
  if (!config) throw new AiError("Workers AI is not configured", "auth");
  let res: Response;
  try {
    res = await transport(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AiError(`Workers AI request failed: ${err instanceof Error ? err.message : "network error"}`, "transient");
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status === 401 || res.status === 403) throw new AiError(`Workers AI refused the credentials (HTTP ${res.status})`, "auth");
  if (!res.ok) {
    throw new AiError(`Workers AI HTTP ${res.status}`, res.status === 408 || res.status === 429 || res.status >= 500 ? "transient" : "invalid");
  }
  return json ?? {};
}

/** Embeddings for texts (batched); null when Workers AI isn't configured */
export async function embed(texts: string[]): Promise<number[][] | null> {
  if (!aiConfig() || !texts.length) return aiConfig() ? [] : null;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50).map((t) => t.slice(0, 8000));
    const json = await post(`run/${EMBEDDING_MODEL}`, { text: batch }, 60_000);
    const data = (json.result as { data?: number[][] } | undefined)?.data;
    if (!Array.isArray(data) || data.length !== batch.length) throw new AiError("Embedding response had the wrong shape", "invalid");
    out.push(...data);
  }
  return out;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface ChatTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** One OpenAI-compatible chat completion */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: { tools?: ChatTool[]; maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
) {
  const config = aiConfig();
  if (!config) throw new AiError("Workers AI is not configured", "auth");
  const json = await post(
    "v1/chat/completions",
    {
      model: config.model,
      messages,
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
      max_tokens: opts.maxTokens ?? 1200,
      temperature: opts.temperature ?? 0.3,
    },
    opts.timeoutMs ?? 120_000,
  );
  const choice = (json.choices as Array<{ message?: ChatMessage }> | undefined)?.[0]?.message;
  if (!choice) throw new AiError("Chat response had no message", "invalid");
  return choice;
}
