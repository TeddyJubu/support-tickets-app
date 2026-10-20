import { cookies } from "next/headers";
import { agentFromSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { storeSettings } from "@/lib/settings";
import { SupportApp } from "./components/support-app";

// Rendered per request, so the store settings come from this install's .env.local, not the build
export const dynamic = "force-dynamic";

export default async function SupportTicketsPage() {
  const agent = agentFromSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return <SupportApp store={storeSettings()} agent={agent} />;
}
