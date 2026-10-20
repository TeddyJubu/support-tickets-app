import { createRuntime } from "@yourgpt/llm-sdk";
import { createOpenAI } from "@yourgpt/llm-sdk/openai";
import { signInRequired, staffFromRequest } from "@/lib/request-auth";

// Cloudflare Workers AI exposes an OpenAI-compatible Chat Completions API.
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const model = process.env.CF_MODEL ?? "@cf/zai-org/glm-5.3-flash";

const workersAI = createOpenAI({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  baseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
});

const runtime = createRuntime({
  provider: workersAI,
  model,
  systemPrompt:
    "You are a helpful customer support assistant. Be concise and helpful.",
});

// Signed-in staff only: this spends the owner's Workers AI quota
export async function POST(request: Request) {
  if (!staffFromRequest(request)) return signInRequired();
  return runtime.handleRequest(request);
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
