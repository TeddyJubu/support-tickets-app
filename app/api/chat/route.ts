import { createRuntime } from "@yourgpt/llm-sdk";
import { createOpenAI } from "@yourgpt/llm-sdk/openai";
import { signInRequired, staffFromRequest } from "@/lib/request-auth";
import { copilotPrompt } from "@/lib/settings";

// Cloudflare Workers AI exposes an OpenAI-compatible Chat Completions API.
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const model = process.env.CF_MODEL ?? "@cf/zai-org/glm-5.3-flash";

const workersAI = createOpenAI({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  baseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
});

const runtime = createRuntime({ provider: workersAI, model, systemPrompt: copilotPrompt() });

// The copilot SDK sends the open ticket's context (useAIContext) in systemPrompt, after this
// heading. Keep that part; the instructions before it always come from the store settings.
const CONTEXT_HEADING = "## Current App Context:";

// Signed-in staff only: this spends the owner's Workers AI quota
export async function POST(request: Request) {
  if (!staffFromRequest(request)) return signInRequired();
  const body = (await request.json().catch(() => null)) as { systemPrompt?: unknown } | null;
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid JSON" }, { status: 400 });
  const sent = typeof body.systemPrompt === "string" ? body.systemPrompt : "";
  const at = sent.indexOf(CONTEXT_HEADING);
  body.systemPrompt = at >= 0 ? `${copilotPrompt()}\n\n${sent.slice(at)}` : copilotPrompt();
  return runtime.handleRequest(
    new Request(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: request.signal,
    }),
  );
}

export async function GET(request: Request) {
  if (!staffFromRequest(request)) return signInRequired();
  return Response.json({
    status: "ok",
    provider: "cloudflare-workers-ai",
    model,
    configured: Boolean(accountId && process.env.CLOUDFLARE_API_TOKEN),
  });
}
