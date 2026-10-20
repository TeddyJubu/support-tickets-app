// Simulated returns and exchanges (the Redo stand-in). Only shown for an order that belongs
// to the ticket's own customer, the same rule the Shopify helpdesk's Redo worker uses.

import { getDb } from "./sim-db";

export const RETURN_STATUSES = ["requested", "label_sent", "in_transit", "received", "refunded", "exchanged", "rejected"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export interface SimReturn {
  id: number;
  orderName: string;
  kind: "return" | "exchange";
  status: ReturnStatus;
  items: string[];
  refundAmount: number | null;
  storeCredit: number | null;
  exchangeFor: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;
const iso = (v: unknown) => `${String(v).replace(" ", "T")}Z`;
const num = (v: unknown) => (v == null ? null : Number(v));

const toReturn = (r: Row): SimReturn => ({
  id: Number(r.id),
  orderName: String(r.order_name),
  kind: r.kind === "exchange" ? "exchange" : "return",
  status: String(r.status) as ReturnStatus,
  items: JSON.parse(String(r.items ?? "[]")) as string[],
  refundAmount: num(r.refund_amount),
  storeCredit: num(r.store_credit),
  exchangeFor: r.exchange_for == null ? null : String(r.exchange_for),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export interface SimReturnInput {
  kind?: "return" | "exchange";
  status?: ReturnStatus;
  items?: string[];
  refundAmount?: number | null;
  storeCredit?: number | null;
  exchangeFor?: string | null;
}

export function createSimReturn(ticketId: string, orderName: string, input: SimReturnInput) {
  const d = getDb();
  const t = d.prepare(`SELECT customer_id FROM sim_tickets WHERE id = ?`).get(ticketId) as Row | undefined;
  if (!t) throw new Error("Ticket not found");
  const status = RETURN_STATUSES.includes(input.status as ReturnStatus) ? input.status! : "requested";
  const res = d
    .prepare(
      `INSERT INTO sim_returns (ticket_id, customer_id, order_name, kind, status, items, refund_amount, store_credit, exchange_for)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ticketId, String(t.customer_id), orderName, input.kind === "exchange" ? "exchange" : "return", status,
      JSON.stringify((input.items ?? []).map((i) => String(i).slice(0, 200)).slice(0, 20)),
      input.refundAmount ?? null, input.storeCredit ?? null, input.exchangeFor ?? null,
    );
  return Number(res.lastInsertRowid);
}

/** Returns for an order, only if that order is on one of this customer's tickets */
export function returnsForTicket(ticketId: string, orderName?: string | null) {
  const d = getDb();
  const t = d.prepare(`SELECT customer_id, order_name FROM sim_tickets WHERE id = ?`).get(ticketId) as Row | undefined;
  if (!t) return [];
  const name = orderName ?? (t.order_name == null ? null : String(t.order_name));
  if (!name) return [];
  const verified = d.prepare(`SELECT 1 FROM sim_tickets WHERE customer_id = ? AND order_name = ?`).get(String(t.customer_id), name);
  if (!verified) return [];
  return (
    d.prepare(`SELECT * FROM sim_returns WHERE order_name = ? AND customer_id = ? ORDER BY id DESC`).all(name, String(t.customer_id)) as Row[]
  ).map(toReturn);
}
