import { storeSettings } from "@/lib/settings";
import { SupportApp } from "./components/support-app";

// Rendered per request, so the store settings come from this install's .env.local, not the build
export const dynamic = "force-dynamic";

export default function SupportTicketsPage() {
  return <SupportApp store={storeSettings()} />;
}
