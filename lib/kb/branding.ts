import { storeSettings } from "../settings";

const LEGACY_STORE_BRAND = /\bButtons\s+Bebe\b/gi;

/** Replace known pre-install branding when knowledge-base text is shown to staff or AI. */
export function normalizeLegacyStoreBrand(text: string, storeName = storeSettings().name) {
  const current = storeName.trim();
  if (!text || !current || current.toLowerCase() === "buttons bebe") return text;
  return text.replace(LEGACY_STORE_BRAND, current);
}
