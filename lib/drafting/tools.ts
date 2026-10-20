// Read-only tools the drafting model may call. Nothing here can change a ticket, an order
// or anything outside the helpdesk; orders are limited to the ticket's own simulated ones.

import type { ChatTool } from "../workers-ai";
import { searchKb } from "../kb/search";
import { getDb, isSimOrder } from "../sim-db";
import { getOrderByName, storeConfig } from "../store-d1.mjs";
import { neutralize } from "./markers";
import { returnsForTicket } from "../returns";

export interface ToolContext {
  ticketId: string;
  customerId: string | null;
  orderName: string | null;
  /** Filled in as tools run */
  kbTitles: Set<string>;
  kbSensitive: boolean;
  calls: Array<{ name: string; ok: boolean }>;
}

export const TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "search_kb",
      description:
        "Search the store's knowledge base (policies, FAQ, intents, solved examples, product facts) and the owner's live notices. Call it before answering anything about policy, shipping, returns, refunds, sizing or products. Notices override articles.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What the customer needs, in plain words" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order",
      description: "Look up the order this ticket is about: items, payment and shipping status, tracking, refunds.",
      parameters: {
        type: "object",
        properties: { order_name: { type: "string", description: "Order name like #S1001; defaults to the ticket's order" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_returns",
      description:
        "Return and exchange status for the ticket's order (requested, label sent, in transit, received, refunded/exchanged). Background for the reply: never promise or confirm a refund.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customer_tickets",
      description: "The customer's other support tickets (subject, status, dates), to spot repeat problems.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const clip = (v: unknown, n: number) => neutralize(String(v ?? "")).slice(0, n);

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  try {
    const out = await dispatch(name, args, ctx);
    ctx.calls.push({ name, ok: true });
    return out;
  } catch (err) {
    ctx.calls.push({ name, ok: false });
    return JSON.stringify({ error: `Tool failed: ${err instanceof Error ? err.message : "error"}` });
  }
}

async function dispatch(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (name === "search_kb") {
    const query = String(args.query ?? "").slice(0, 500);
    if (!query.trim()) return JSON.stringify({ error: "query is required" });
    const out = await searchKb(query, 5);
    for (const r of out.results) ctx.kbTitles.add(r.title);
    if (out.results.some((r) => r.sensitive)) ctx.kbSensitive = true;
    return JSON.stringify({
      search: out.mode,
      notices: out.notices.map((n) => ({ title: clip(n.title, 200), notice: clip(n.body, 1500), overrides_kb: true })),
      results: out.results.map((r) => ({
        title: clip(r.title, 200),
        section: clip(r.heading, 200),
        category: r.folder,
        sensitive: r.sensitive,
        text: clip(r.text, 1200),
      })),
    });
  }
  if (name === "get_order") {
    const orderName = String(args.order_name || ctx.orderName || "").trim();
    if (!orderName) return JSON.stringify({ error: "This ticket has no order on file. Ask the customer for their order number if it matters." });
    // Only orders the simulator attached to tickets: the store holds real customer data
    if (!/^#S\d+$/.test(orderName) || !isSimOrder(orderName)) return JSON.stringify({ error: `Order ${clip(orderName, 30)} isn't available to look up` });
    const config = storeConfig(process.env);
    if (!config) return JSON.stringify({ error: "The store isn't connected" });
    const order = await getOrderByName(config, orderName);
    if (!order) return JSON.stringify({ error: "Order not found" });
    return JSON.stringify({
      name: order.name,
      placed: order.created_at,
      total: order.total_price,
      payment: order.financial_status,
      fulfillment: order.fulfillment_status ?? "unfulfilled",
      cancelled: order.cancelled_at ?? null,
      items: order.line_items.map((l: { quantity: number; title: string; price: string }) => `${l.quantity}× ${clip(l.title, 120)} ($${l.price})`),
      shipments: order.fulfillments.map((f: { status: string; tracking_company: string | null; tracking_number: string | null }) => ({
        status: f.status,
        carrier: f.tracking_company,
        tracking: f.tracking_number,
      })),
      refunded: order.refunds.flatMap((r: { transactions: Array<{ amount: string }> }) => r.transactions).reduce((s: number, t: { amount: string }) => s + Number(t.amount), 0),
    });
  }
  if (name === "get_returns") {
    const returns = returnsForTicket(ctx.ticketId);
    return JSON.stringify({
      returns: returns.map((r) => ({
        order: r.orderName,
        kind: r.kind,
        status: r.status,
        items: r.items.map((i) => clip(i, 120)),
        refund_amount: r.refundAmount,
        exchange_for: r.exchangeFor ? clip(r.exchangeFor, 120) : null,
        updated: r.updatedAt,
      })),
      note: returns.length ? undefined : "No return or exchange on file for this ticket's order",
    });
  }
  if (name === "get_customer_tickets") {
    if (!ctx.customerId) return JSON.stringify({ tickets: [] });
    const rows = getDb()
      .prepare(`SELECT id, subject, status, created_at FROM sim_tickets WHERE customer_id = ? AND id != ? ORDER BY seq DESC LIMIT 10`)
      .all(ctx.customerId, ctx.ticketId) as Array<Record<string, unknown>>;
    return JSON.stringify({ tickets: rows.map((r) => ({ id: r.id, subject: clip(r.subject, 200), status: r.status, opened: r.created_at })) });
  }
  return JSON.stringify({ error: `Unknown tool ${clip(name, 40)}` });
}
