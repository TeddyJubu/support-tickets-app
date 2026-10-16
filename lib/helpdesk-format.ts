import type { Customer } from "./helpdesk-types";

export function formatMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatPriceRange(min: number | null, max: number | null) {
  if (min == null) return "—";
  return max != null && max !== min
    ? `${formatMoney(min)} – ${formatMoney(max)}`
    : formatMoney(min);
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = seconds / 3600;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  return `${Math.round(hours / 24)} days`;
}

// Export timestamps are "YYYY-MM-DD HH:MM:SS"
export function parseExportDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | null | undefined) {
  const d = parseExportDate(value);
  return d
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";
}

export function formatTime(value: string | null | undefined) {
  const d = parseExportDate(value);
  return d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
}

export function initials(name: string | null | undefined) {
  const parts = (name ?? "?").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

// Spend-based segment, since the Shopify export has no loyalty tier
export function customerTier(customer: Pick<Customer, "totalSpent" | "totalOrders"> | null) {
  if (!customer) return "Unknown";
  if (customer.totalSpent >= 1500) return "VIP";
  if (customer.totalSpent >= 500) return "Loyal";
  if (customer.totalOrders > 1) return "Returning";
  if (customer.totalOrders === 1) return "New";
  return "No orders";
}

export function customerLocation(customer: Customer | null) {
  if (!customer) return null;
  return [customer.city, customer.province, customer.country].filter(Boolean).join(", ") || null;
}

// "Order::Damaged::Other" -> "Order · Damaged"
export function formatIntent(intent: string | null | undefined) {
  if (!intent) return null;
  return intent
    .split("::")
    .filter((p) => p && p !== "Other")
    .join(" · ") || intent;
}
