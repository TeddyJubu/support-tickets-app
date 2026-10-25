import type { Metadata } from "next";
import { storeSettings } from "@/lib/settings";
import { SupportApp } from "./components/support-app";

// Rendered per request, so the store settings come from this install's .env.local, not the build
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Inbox" };

export default function SupportTicketsPage() {
  const store = storeSettings();
  return <SupportApp store={store} />;
}
