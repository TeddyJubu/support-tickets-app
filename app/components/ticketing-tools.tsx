"use client";

import { Package, Users, Ticket as TicketIcon } from "lucide-react";
import { useTools, useAIContext } from "@yourgpt/copilot-sdk/react";
import { tool, success } from "@yourgpt/copilot-sdk/core";
import { useDashboard } from "./context/dashboard-context";
import type { CustomerRisk, Sentiment, CustomerContext } from "./types";
import type {
  Customer,
  Product,
  SimilarTicket,
  TicketDetail,
  TicketSummary,
} from "@/lib/helpdesk-types";
import {
  customerLocation,
  customerTier,
  formatDate,
  formatDuration,
  formatIntent,
  formatMoney,
  formatPriceRange,
} from "@/lib/helpdesk-format";
import {
  DraftResponseCard,
  TicketSummaryCard,
  SimilarTicketsCard,
  ResolutionSuggestionCard,
  CompensationCard,
  CustomerRiskCard,
  SentimentCard,
  CustomerContextCard,
  CustomerProfileCard,
  OrderDetailsCard,
  KnowledgeBaseCard,
  CallbackScheduledCard,
  EscalationCard,
  DraftResponseSkeleton,
  TicketSummarySkeleton,
  SimilarTicketsSkeleton,
  CompensationSkeleton,
  ResolutionSkeleton,
  CustomerRiskSkeleton,
  SentimentSkeleton,
  CustomerContextSkeleton,
  KnowledgeBaseSkeleton,
  CallbackSkeleton,
  EscalationSkeleton,
  CustomerProfileSkeleton,
  CardSkeleton,
} from "./tool-cards";

// Order as returned by the demo store (Shopify Admin REST shape)
interface StoreOrder {
  id: number;
  name: string;
  total_price: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  created_at: string;
  line_items: Array<{ title: string; quantity: number; price: string; sku: string | null }>;
  fulfillments: Array<{ status: string; tracking_number: string | null; tracking_company: string | null }>;
  refunds: Array<{ transactions: Array<{ amount: string }> }>;
}

function orderSummary(o: StoreOrder) {
  const items = o.line_items.map((l) => `${l.quantity}× ${l.title}`).join(", ");
  const shipment = o.fulfillments[0];
  const refunded = o.refunds
    .flatMap((r) => r.transactions)
    .reduce((sum, t) => sum + Number(t.amount), 0);
  return {
    items,
    status: o.cancelled_at
      ? "cancelled"
      : [o.financial_status, o.fulfillment_status ?? "unfulfilled"].filter(Boolean).join(" · "),
    shipping: shipment
      ? `${shipment.tracking_company ?? "Carrier"} ${shipment.tracking_number ?? ""} (${shipment.status})`.trim()
      : "Not shipped yet",
    refunded,
  };
}

type RenderStatus =
  | "pending"
  | "approval-required"
  | "executing"
  | "completed"
  | "error";

const isLoading = (status: RenderStatus) =>
  status === "pending" || status === "executing";

function ErrorCard({ label, error }: { label: string; error?: string }) {
  return (
    <div className="bg-card border border-red-500/30 rounded-xl p-4">
      <span className="text-sm text-red-500">
        {label} failed: {error || "Unknown error"}
      </span>
    </div>
  );
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

function customerName(detail: TicketDetail | null) {
  return (
    detail?.customer?.name ??
    detail?.ticket.customerName ??
    detail?.ticket.customerEmail ??
    "the customer"
  );
}

function profileFor(detail: TicketDetail | null) {
  const c = detail?.customer;
  return {
    name: customerName(detail),
    email: c?.email ?? detail?.ticket.customerEmail ?? "—",
    phone: c?.phone ?? "—",
    tier: customerTier(c ?? null),
    totalOrders: c?.totalOrders ?? 0,
    lifetimeValue: formatMoney(c?.totalSpent ?? 0),
  };
}

// Customer intelligence derived from the Shopify + Gorgias exports
function contextFor(detail: TicketDetail): CustomerContext {
  const { customer, stats, ticket } = detail;
  const tier = customerTier(customer);
  const riskFactors: string[] = [];
  const recommendations: string[] = [];

  if (!customer) riskFactors.push("No matching Shopify customer for this email");
  if (stats.ticketsLast90Days >= 3)
    riskFactors.push(`${stats.ticketsLast90Days} tickets in the last 90 days`);
  if (stats.criticalTickets > 0)
    riskFactors.push(`${stats.criticalTickets} high/critical priority ticket(s)`);
  if ((stats.avgResolutionSeconds ?? 0) > 3 * 86400)
    riskFactors.push(
      `Slow average resolution (${formatDuration(stats.avgResolutionSeconds)})`,
    );
  if (ticket.customerMessages > 3)
    riskFactors.push(`${ticket.customerMessages} customer messages on this ticket`);
  if (customer && !customer.acceptsEmail)
    riskFactors.push("Not subscribed to email marketing");

  if (tier === "VIP" || tier === "Loyal")
    recommendations.push(
      `High-value customer (${formatMoney(customer?.totalSpent)}) — prioritize a fast, generous resolution`,
    );
  if (stats.topIntents[0])
    recommendations.push(
      `Most common contact reason: ${formatIntent(stats.topIntents[0].intent)} (${stats.topIntents[0].count}×)`,
    );
  if (ticket.aiIntent && /return|exchange|refund/i.test(ticket.aiIntent))
    recommendations.push("Check the order's return/exchange eligibility before replying");
  if (ticket.aiIntent && /status|shipping|delivery/i.test(ticket.aiIntent))
    recommendations.push("Look up tracking for the order before replying");
  if (customer?.note) recommendations.push(`Account note: ${customer.note}`);
  if (!recommendations.length)
    recommendations.push("Reply with a clear next step and an expected timeline");

  return {
    ltv: formatMoney(customer?.totalSpent ?? 0),
    tier,
    orderCount: customer?.totalOrders ?? 0,
    ticketCount: stats.ticketCount,
    avgResponseTime: formatDuration(stats.avgFirstResponseSeconds),
    ticketsLast90Days: stats.ticketsLast90Days,
    riskFactors,
    recommendations,
  };
}

// Store-style compensation tiers based on how much the customer has spent
function compensationOptions(detail: TicketDetail | null, severity: string) {
  const spent = detail?.customer?.totalSpent ?? 0;
  const high = severity === "high";
  const credit = Math.max(10, Math.round(Math.min(spent * (high ? 0.1 : 0.05), 75)));
  return [
    {
      type: "Store Credit",
      value: formatMoney(credit),
      description: `Credit toward the next order (${high ? "10%" : "5%"} of lifetime spend, capped at $75)`,
    },
    {
      type: "Discount Code",
      value: high ? "20% off" : "10% off",
      description: "One-time code for the customer's next purchase",
    },
    {
      type: "Free Shipping",
      value: "Next order",
      description: "Free standard shipping, or a prepaid label for a return/exchange",
    },
  ];
}

function productSnippet(p: Product) {
  return [
    formatPriceRange(p.priceMin, p.priceMax),
    `${p.inventory} in stock`,
    p.options,
    p.status && p.status !== "active" ? `status: ${p.status}` : null,
    p.finalSale ? "final sale" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function customerSnippet(c: Customer) {
  return [
    c.email,
    `${formatMoney(c.totalSpent)} over ${c.totalOrders} order${c.totalOrders === 1 ? "" : "s"}`,
    customerLocation(c),
  ]
    .filter(Boolean)
    .join(" · ");
}

function ticketSnippet(t: TicketSummary) {
  return [
    t.customerName ?? t.customerEmail,
    formatDate(t.createdAt),
    formatIntent(t.aiIntent),
    t.tags,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Live ticket + customer data for the AI
function TicketContext() {
  const { ticketDetail } = useDashboard();
  const t = ticketDetail?.ticket;
  const c = ticketDetail?.customer;
  useAIContext({
    key: "current-ticket",
    description: t?.simulated
      ? "The support ticket the agent has open. It's a SIMULATED ticket from the test simulator (pseudonymous customer), with the full email conversation."
      : "The support ticket the agent has open, from the store's Gorgias export, with the matching Shopify customer. Message bodies are not available, only the subject and metadata.",
    data: ticketDetail
      ? {
          ticket: {
            id: t!.id,
            simulated: Boolean(t!.simulated),
            status: t!.status ?? (t!.closedAt ? "closed" : "open"),
            order: t!.orderName ?? null,
            subject: t!.subject,
            createdAt: t!.createdAt,
            closedAt: t!.closedAt,
            priority: t!.priority,
            tags: t!.tags,
            intent: formatIntent(t!.aiIntent),
            assignee: t!.assigneeName,
            customerMessages: t!.customerMessages,
            agentMessages: t!.agentMessages,
            firstResponse: formatDuration(t!.firstResponseSeconds),
            resolutionTime: formatDuration(t!.resolutionSeconds),
          },
          customer: c
            ? {
                name: c.name,
                email: c.email,
                phone: c.phone,
                location: customerLocation(c),
                totalSpent: formatMoney(c.totalSpent),
                totalOrders: c.totalOrders,
                tier: customerTier(c),
                tags: c.tags,
                note: c.note,
              }
            : { name: t!.customerName, email: t!.customerEmail, inShopify: false },
          stats: {
            ...ticketDetail.stats,
            avgFirstResponse: formatDuration(ticketDetail.stats.avgFirstResponseSeconds),
            avgResolution: formatDuration(ticketDetail.stats.avgResolutionSeconds),
          },
          conversation: ticketDetail.messages?.map((m) => ({
            from: m.author,
            at: m.createdAt,
            text: m.body,
          })),
          recentTickets: ticketDetail.history.slice(0, 8).map((h) => ({
            id: h.id,
            subject: h.subject,
            createdAt: h.createdAt,
            intent: formatIntent(h.aiIntent),
          })),
        }
      : { loading: true },
  });
  return null;
}

export function TicketingTools() {
  const dashboard = useDashboard();

  // useTools registers these once, so handlers read the open ticket when they run
  const requireTicket = () => {
    const detail = dashboard.getTicketDetail();
    if (!detail) throw new Error("No ticket is open");
    return detail;
  };

  // Note: useTools types expect ToolDefinition but tool() returns Omit<ToolDefinition, "name">
  // The name is derived from the object key at runtime. Using 'as any' to work around type mismatch.
  useTools({
    // ========================================
    // DATA LOOKUP TOOLS (seeded store data)
    // ========================================

    get_customer_profile: tool({
      title: "Customer profile",
      executingTitle: "Loading profile...",
      completedTitle: "Customer profile",
      description:
        "Show the open ticket's customer profile from Shopify: contact details, order count and lifetime spend.",
      location: "client",
      aiResponseMode: "brief",
      aiContext: (result) => {
        const p = (result.data as { profile: ReturnType<typeof profileFor> })?.profile;
        return `[UI Card Displayed: ${p?.name} — ${p?.tier}, ${p?.totalOrders} orders, ${p?.lifetimeValue} spent. Acknowledge briefly.]`;
      },
      inputSchema: { type: "object", properties: {} },
      handler: async () => success({ profile: profileFor(requireTicket()) }),
      render: (props) => {
        if (isLoading(props.status)) return <CustomerProfileSkeleton />;
        const data = props.result?.data as
          | { profile: ReturnType<typeof profileFor> }
          | undefined;
        if (props.status === "error") return <ErrorCard label="Profile" error={props.error} />;
        return data ? <CustomerProfileCard customer={data.profile} /> : null;
      },
    }),

    get_customer_context: tool({
      title: "Get customer intelligence",
      executingTitle: "Gathering customer data...",
      completedTitle: "Customer context loaded",
      description:
        "Customer intelligence for the open ticket from real store data: lifetime spend, orders, ticket history, response times, risk factors and handling recommendations.",
      location: "client",
      aiResponseMode: "brief",
      aiContext: (result) => {
        const ctx = (result.data as { context: CustomerContext } | undefined)?.context;
        return `[UI Card Displayed: ${ctx?.ltv} LTV, ${ctx?.tier}, ${ctx?.orderCount} orders, ${ctx?.ticketCount} tickets (${ctx?.ticketsLast90Days} in 90 days). Risk factors: ${ctx?.riskFactors.join("; ") || "none"}. Recommendations: ${ctx?.recommendations.join("; ")}. Briefly mention the key insight only.]`;
      },
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const context = contextFor(requireTicket());
        dashboard.setCustomerContext(context);
        return success({ context });
      },
      render: (props) => {
        if (isLoading(props.status)) return <CustomerContextSkeleton />;
        if (props.status === "error") return <ErrorCard label="Customer context" error={props.error} />;
        const data = props.result?.data as { context: CustomerContext } | undefined;
        return data ? <CustomerContextCard context={data.context} /> : null;
      },
    }),

    find_similar_tickets: tool({
      title: "Find similar tickets",
      executingTitle: "Searching ticket history...",
      completedTitle: "Found similar tickets",
      description:
        "Find past tickets similar to the open one (same AI intent and similar subject) from the store's ticket history.",
      location: "client",
      aiResponseMode: "brief",
      aiContext: (result) => {
        const tickets = (result.data as { tickets: SimilarTicket[] } | undefined)?.tickets ?? [];
        if (!tickets.length) return "[No similar tickets found]";
        return `[UI Card Displayed: ${tickets.length} similar tickets: ${tickets
          .map((t) => `#${t.id} "${t.subject}" (${t.similarity}%, ${formatIntent(t.aiIntent) ?? "no intent"}, resolved in ${formatDuration(t.resolutionSeconds)})`)
          .join("; ")}. Briefly mention the key pattern only.]`;
      },
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many tickets to return (default 5)" },
        },
      },
      handler: async (params) => {
        const { ticket } = requireTicket();
        const limit = Number(params.limit) || 5;
        return success(
          await getJson<{ tickets: SimilarTicket[] }>(
            `/api/helpdesk/tickets/${ticket.id}/similar?limit=${limit}`,
          ),
        );
      },
      render: (props) => {
        if (isLoading(props.status)) return <SimilarTicketsSkeleton />;
        if (props.status === "error") return <ErrorCard label="Similar tickets" error={props.error} />;
        const data = props.result?.data as { tickets: SimilarTicket[] } | undefined;
        if (!data) return null;
        return (
          <SimilarTicketsCard
            tickets={data.tickets.map((t) => ({
              id: t.id,
              title: t.subject ?? "(no subject)",
              status: t.closedAt ? "Resolved" : "Open",
              resolution: `${formatIntent(t.aiIntent) ?? "No intent"} · ${t.agentMessages} agent repl${t.agentMessages === 1 ? "y" : "ies"} · closed in ${formatDuration(t.resolutionSeconds)}`,
              similarity: t.similarity,
            }))}
            onLinkTicket={(ticket) => dashboard.addLinkedTicket(ticket)}
          />
        );
      },
    }),

    search_products: tool({
      title: (args) => `Products: "${args.query || "..."}"`,
      executingTitle: "Searching the catalog...",
      completedTitle: "Products found",
      description:
        "Search the store's product catalog (Shopify export) by name, type, tag, size or SKU. Returns price, stock, sizes and status.",
      location: "client",
      aiResponseMode: "brief",
      aiContext: (result) => {
        const products = (result.data as { products: Product[] } | undefined)?.products ?? [];
        if (!products.length) return "[No matching products]";
        return `[UI Card Displayed: ${products.length} products: ${products
          .map((p) => `${p.title} (${productSnippet(p)})`)
          .join("; ")}. Answer the agent's question briefly using this data.]`;
      },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Product name, type, tag, size or SKU" },
        },
        required: ["query"],
      },
      handler: async (params) =>
        success(
          await getJson<{ products: Product[] }>(
            `/api/helpdesk/products?q=${encodeURIComponent(String(params.query ?? ""))}`,
          ),
        ),
      render: (props) => {
        if (isLoading(props.status)) return <KnowledgeBaseSkeleton />;
        if (props.status === "error") return <ErrorCard label="Product search" error={props.error} />;
        const data = props.result?.data as { products: Product[] } | undefined;
        if (!data) return null;
        return (
          <KnowledgeBaseCard
            title="Products"
            itemLabel="products"
            icon={Package}
            articles={data.products.map((p) => ({
              title: p.title ?? p.handle,
              snippet: productSnippet(p),
            }))}
          />
        );
      },
    }),

    search_customers: tool({
      title: (args) => `Customers: "${args.query || "..."}"`,
      executingTitle: "Searching customers...",
      completedTitle: "Customers found",
      description:
        "Search Shopify customers by name, email, phone, city or tag. Returns spend, order count and location.",
      location: "client",
      aiResponseMode: "brief",
      aiContext: (result) => {
        const customers = (result.data as { customers: Customer[] } | undefined)?.customers ?? [];
        if (!customers.length) return "[No matching customers]";
        return `[UI Card Displayed: ${customers.length} customers: ${customers
          .map((c) => `${c.name ?? "Unnamed"} (${customerSnippet(c)})`)
          .join("; ")}. Answer briefly.]`;
      },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name, email, phone, city or tag" },
        },
        required: ["query"],
      },
      handler: async (params) =>
        success(
          await getJson<{ customers: Customer[] }>(
            `/api/helpdesk/customers?q=${encodeURIComponent(String(params.query ?? ""))}`,
          ),
        ),
      render: (props) => {
        if (isLoading(props.status)) return <KnowledgeBaseSkeleton />;
        if (props.status === "error") return <ErrorCard label="Customer search" error={props.error} />;
        const data = props.result?.data as { customers: Customer[] } | undefined;
        if (!data) return null;
        return (
          <KnowledgeBaseCard
            title="Customers"
            itemLabel="customers"
            icon={Users}
            articles={data.customers.map((c) => ({
              title: c.name ?? c.email ?? c.id,
              snippet: customerSnippet(c),
            }))}
          />
        );
      },
    }),

    search_tickets: tool({
      title: (args) => `Tickets: "${args.query || "..."}"`,
      executingTitle: "Searching tickets...",
      completedTitle: "Tickets found",
      description:
        "Search all past support tickets by subject, customer name/email, tag or intent (e.g. 'damaged', 'return', an order number).",
      location: "client",
      aiResponseMode: "brief",
      aiContext: (result) => {
        const data = result.data as { tickets: TicketSummary[]; total: number } | undefined;
        if (!data?.tickets.length) return "[No matching tickets]";
        return `[UI Card Displayed: ${data.total} matching tickets, showing ${data.tickets.length}: ${data.tickets
          .map((t) => `#${t.id} "${t.subject}" (${ticketSnippet(t)})`)
          .join("; ")}. Answer briefly.]`;
      },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text or a ticket ID" },
        },
        required: ["query"],
      },
      handler: async (params) =>
        success(
          await getJson<{ tickets: TicketSummary[]; total: number }>(
            `/api/helpdesk/tickets?limit=8&q=${encodeURIComponent(String(params.query ?? ""))}`,
          ),
        ),
      render: (props) => {
        if (isLoading(props.status)) return <KnowledgeBaseSkeleton />;
        if (props.status === "error") return <ErrorCard label="Ticket search" error={props.error} />;
        const data = props.result?.data as { tickets: TicketSummary[] } | undefined;
        if (!data) return null;
        return (
          <KnowledgeBaseCard
            title="Tickets"
            itemLabel="tickets"
            icon={TicketIcon}
            articles={data.tickets.map((t) => ({
              title: `#${t.id} ${t.subject ?? "(no subject)"}`,
              snippet: ticketSnippet(t),
              onOpen: () => dashboard.selectTicket(t.id),
            }))}
          />
        );
      },
    }),

    get_order_details: tool({
      title: "Order details",
      executingTitle: "Looking up the order...",
      completedTitle: (args) => `Order ${args.orderName ?? ""}`.trim(),
      description:
        "Look up the order a simulated ticket is about in the demo store: items, total, payment/fulfillment status, tracking and refunds. Only works for orders attached to simulated tickets.",
      location: "client",
      aiResponseMode: "brief",
      aiContext: (result) => {
        const o = (result.data as { order: StoreOrder } | undefined)?.order;
        if (!o) return "[Order not found]";
        const sum = orderSummary(o);
        return `[UI Card Displayed: order ${o.name}, $${o.total_price}, ${sum.status}; items: ${sum.items}; shipping: ${sum.shipping}${sum.refunded ? `; refunded $${sum.refunded.toFixed(2)}` : ""}. Answer briefly using this.]`;
      },
      inputSchema: {
        type: "object",
        properties: {
          orderName: {
            type: "string",
            description: "Order name like #S1001 (defaults to the open ticket's order)",
          },
        },
      },
      handler: async (params) => {
        const name = String(params.orderName || requireTicket().ticket.orderName || "");
        if (!name) throw new Error("This ticket isn't linked to a store order");
        return success(
          await getJson<{ order: StoreOrder }>(`/api/helpdesk/orders?name=${encodeURIComponent(name)}`),
        );
      },
      render: (props) => {
        if (isLoading(props.status)) return <CardSkeleton />;
        if (props.status === "error") return <ErrorCard label="Order lookup" error={props.error} />;
        const o = (props.result?.data as { order: StoreOrder } | undefined)?.order;
        if (!o) return null;
        const sum = orderSummary(o);
        return (
          <OrderDetailsCard
            order={{
              id: o.name,
              product: sum.items,
              price: Number(o.total_price),
              status: sum.status,
              date: formatDate(o.created_at.replace("T", " ").slice(0, 19)),
              shippingAddress: sum.refunded
                ? `${sum.shipping} · refunded ${formatMoney(sum.refunded)}`
                : sum.shipping,
            }}
          />
        );
      },
    }),

    // ========================================
    // AI ANALYSIS TOOLS (model fills in the content)
    // ========================================

    generate_summary: tool({
      title: "Generate ticket summary",
      executingTitle: "Summarizing ticket...",
      completedTitle: "Summary generated",
      description:
        "Display a summary of the open ticket for handoff or escalation. Write it from the ticket subject, intent, tags, timing and customer history in context. Don't invent message content.",
      location: "client",
      aiResponseMode: "none",
      aiContext: "[UI Card Displayed: ticket summary. Do NOT repeat it — acknowledge briefly.]",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "2-3 sentence summary" },
          keyPoints: { type: "array", items: { type: "string" }, description: "3-5 key facts" },
          nextSteps: { type: "array", items: { type: "string" }, description: "2-4 next steps" },
        },
        required: ["summary", "keyPoints", "nextSteps"],
      },
      handler: async (params) => success(params),
      render: (props) => {
        if (isLoading(props.status)) return <TicketSummarySkeleton />;
        const data = props.result?.data as
          | { summary: string; keyPoints: string[]; nextSteps: string[] }
          | undefined;
        if (!data) return null;
        return (
          <TicketSummaryCard
            summary={data.summary}
            keyPoints={data.keyPoints ?? []}
            nextSteps={data.nextSteps ?? []}
          />
        );
      },
    }),

    detect_sentiment: tool({
      title: "Detect sentiment",
      executingTitle: "Reading customer mood...",
      completedTitle: "Sentiment detected",
      description:
        "Display your assessment of the customer's sentiment and update the dashboard indicator. Base it on the subject, tags, priority, number of customer messages and ticket history.",
      location: "client",
      aiResponseMode: "none",
      aiContext: (result) => {
        const s = (result.data as { sentiment: Sentiment } | undefined)?.sentiment;
        return `[UI Card Displayed: ${s?.emoji} ${s?.label} (${s?.score}/100). Dashboard updated. Acknowledge briefly.]`;
      },
      inputSchema: {
        type: "object",
        properties: {
          emoji: { type: "string", description: "Single emoji for the mood" },
          label: { type: "string", description: "Short label, e.g. 'Frustrated'" },
          score: { type: "number", description: "0 (very negative) to 100 (very positive)" },
          reasons: { type: "array", items: { type: "string" }, description: "Evidence from the ticket data" },
        },
        required: ["emoji", "label", "score", "reasons"],
      },
      handler: async (params) => {
        const sentiment: Sentiment = {
          emoji: String(params.emoji ?? "😐"),
          label: String(params.label ?? "Neutral"),
          score: Number(params.score ?? 50),
          reasons: (params.reasons as string[]) ?? [],
        };
        dashboard.setSentiment(sentiment);
        return success({ sentiment });
      },
      render: (props) => {
        if (isLoading(props.status)) return <SentimentSkeleton />;
        const data = props.result?.data as { sentiment: Sentiment } | undefined;
        return data ? <SentimentCard sentiment={data.sentiment} /> : null;
      },
    }),

    analyze_customer_risk: tool({
      title: "Analyze churn risk",
      executingTitle: "Analyzing customer patterns...",
      completedTitle: "Risk assessment complete",
      description:
        "Display your churn-risk assessment for the customer and update the dashboard. Base it on spend, order count, ticket frequency, priorities and response times in context (call get_customer_context first if needed).",
      location: "client",
      aiResponseMode: "none",
      aiContext: (result) => {
        const r = (result.data as { risk: CustomerRisk } | undefined)?.risk;
        return `[UI Card Displayed: ${r?.level?.toUpperCase()} churn risk (${r?.score}/100). Dashboard updated. Acknowledge briefly.]`;
      },
      inputSchema: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["low", "medium", "high"] },
          score: { type: "number", description: "0-100, higher is riskier" },
          reasons: { type: "array", items: { type: "string" }, description: "Evidence from the data" },
        },
        required: ["level", "score", "reasons"],
      },
      handler: async (params) => {
        const risk: CustomerRisk = {
          level: (params.level as CustomerRisk["level"]) ?? "medium",
          score: Number(params.score ?? 50),
          reasons: (params.reasons as string[]) ?? [],
        };
        dashboard.setCustomerRisk(risk);
        return success({ risk });
      },
      render: (props) => {
        if (isLoading(props.status)) return <CustomerRiskSkeleton />;
        const data = props.result?.data as { risk: CustomerRisk } | undefined;
        return data ? <CustomerRiskCard risk={data.risk} /> : null;
      },
    }),

    draft_response: tool({
      title: (args) => `Draft ${(args.tone as string) || "professional"} response`,
      executingTitle: "Writing response...",
      completedTitle: "Response drafted",
      description:
        "Display a draft email reply to the customer that the agent can edit and send. Write the full subject and body yourself, addressed to the customer by first name and signed 'Cute Things Support'.",
      location: "client",
      aiResponseMode: "none",
      aiContext: (result) => {
        const tone = (result.data as { tone: string } | undefined)?.tone;
        return `[UI Card Displayed: draft reply (${tone} tone). User can edit/send. Do NOT repeat the content — acknowledge briefly.]`;
      },
      inputSchema: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Full email body" },
          tone: {
            type: "string",
            enum: ["professional", "friendly", "empathetic", "apologetic"],
          },
        },
        required: ["subject", "body", "tone"],
      },
      handler: async (params) =>
        success({
          subject: String(params.subject ?? ""),
          body: String(params.body ?? ""),
          tone: String(params.tone ?? "professional"),
        }),
      render: (props) => {
        if (isLoading(props.status)) return <DraftResponseSkeleton />;
        const data = props.result?.data as
          | { subject: string; body: string; tone: string }
          | undefined;
        if (!data) return null;
        return (
          <DraftResponseCard
            subject={data.subject}
            body={data.body}
            tone={data.tone}
            onUseReply={() => dashboard.setComposeText(data.body)}
            onSendEmail={(subject, body) => dashboard.sendAgentMessage(body, "Email", subject)}
          />
        );
      },
    }),

    // ========================================
    // ACTION TOOLS (pause for the agent's approval)
    // ========================================

    suggest_resolution: tool({
      title: "Suggest resolution",
      executingTitle: "Applying resolution...",
      completedTitle: "Resolution applied",
      description:
        "Propose a resolution plan for the open ticket. The agent reviews and confirms it before it's applied. Base it on the intent, similar past tickets and customer value.",
      location: "client",
      needsApproval: true,
      approvalMessage: "Review and confirm the suggested resolution",
      aiResponseMode: "none",
      aiContext: (result) => {
        const data = result.data as { suggestion: string; confirmed: boolean } | undefined;
        return data?.confirmed
          ? `[Resolution APPLIED: "${data.suggestion}". Follow the agreed steps.]`
          : "[Resolution suggestion cancelled by user]";
      },
      inputSchema: {
        type: "object",
        properties: {
          suggestion: { type: "string", description: "One-line resolution" },
          confidence: { type: "number", description: "0-100" },
          reasoning: { type: "string", description: "Why this resolution" },
          steps: { type: "array", items: { type: "string" }, description: "Steps for the agent" },
        },
        required: ["suggestion", "confidence", "reasoning", "steps"],
      },
      handler: async (params, context) => {
        if (!context?.approvalData?.confirmed) {
          return { success: false, error: "Resolution not confirmed" };
        }
        const steps =
          (context.approvalData.modifiedSteps as string[] | undefined) ??
          (params.steps as string[]);
        const suggestion = String(params.suggestion);
        dashboard.setAppliedResolution(suggestion);
        return success({
          suggestion,
          confidence: Number(params.confidence),
          reasoning: String(params.reasoning),
          steps,
          confirmed: true,
        });
      },
      render: (props) => {
        const { status, approval, result, args } = props;
        if (status === "approval-required" && approval) {
          return (
            <ResolutionSuggestionCard
              mode="confirm"
              suggestion={String(args.suggestion ?? "")}
              confidence={Number(args.confidence ?? 0)}
              reasoning={String(args.reasoning ?? "")}
              steps={(args.steps as string[]) ?? []}
              onConfirm={(modifiedSteps) => approval.onApprove({ confirmed: true, modifiedSteps })}
              onCancel={() => approval.onReject("Cancelled by user")}
            />
          );
        }
        if (isLoading(status)) return <ResolutionSkeleton />;
        if (status === "completed" && result?.data) {
          const data = result.data as {
            suggestion: string;
            confidence: number;
            reasoning: string;
            steps: string[];
          };
          return (
            <ResolutionSuggestionCard
              mode="applied"
              suggestion={data.suggestion}
              confidence={data.confidence}
              reasoning={data.reasoning}
              steps={data.steps}
            />
          );
        }
        if (status === "error") return <ErrorCard label="Resolution" error={props.error} />;
        return null;
      },
    }),

    calculate_compensation: tool({
      title: "Calculate compensation",
      executingTitle: "Sending offer...",
      completedTitle: "Compensation offer sent",
      description:
        "Offer the customer compensation (store credit, discount code or free shipping) sized to their lifetime spend. The agent picks which offer to send.",
      location: "client",
      needsApproval: true,
      approvalMessage: "Select a compensation offer to send to the customer",
      aiResponseMode: "none",
      aiContext: (result) => {
        const data = result.data as
          | { selectedOffer?: { type: string; value: string }; customerValue: string }
          | undefined;
        return data?.selectedOffer
          ? `[Compensation SENT: "${data.selectedOffer.type}" (${data.selectedOffer.value}) for a ${data.customerValue} LTV customer.]`
          : "[Compensation cancelled by user]";
      },
      inputSchema: {
        type: "object",
        properties: {
          issueSeverity: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Severity of the issue",
          },
          reasoning: { type: "string", description: "Why compensation is appropriate" },
        },
      },
      handler: async (params, context) => {
        const selectedOffer = context?.approvalData?.selectedOffer as
          | { type: string; value: string; description: string }
          | undefined;
        if (!selectedOffer) return { success: false, error: "No offer selected" };
        dashboard.setSentOffer(selectedOffer);
        const detail = dashboard.getTicketDetail();
        return success({
          options: compensationOptions(detail, String(params.issueSeverity ?? "medium")),
          reasoning: String(params.reasoning ?? ""),
          selectedOffer,
          customerValue: formatMoney(detail?.customer?.totalSpent ?? 0),
        });
      },
      render: (props) => {
        const { status, approval, result, args } = props;
        const detail = dashboard.ticketDetail;
        const options = compensationOptions(detail, String(args.issueSeverity ?? "medium"));
        const customerValue = formatMoney(detail?.customer?.totalSpent ?? 0);
        const reasoning =
          String(args.reasoning ?? "") ||
          `${customerName(detail)} has spent ${customerValue} over ${detail?.customer?.totalOrders ?? 0} orders.`;
        if (status === "approval-required" && approval) {
          return (
            <CompensationCard
              mode="select"
              options={options}
              reasoning={reasoning}
              customerValue={customerValue}
              onSelectOffer={(offer) => approval.onApprove({ selectedOffer: offer })}
              onCancel={() => approval.onReject("Cancelled by user")}
            />
          );
        }
        if (isLoading(status)) return <CompensationSkeleton />;
        if (status === "completed" && result?.data) {
          const data = result.data as {
            options: typeof options;
            reasoning: string;
            selectedOffer: (typeof options)[number];
            customerValue: string;
          };
          return (
            <CompensationCard
              mode="sent"
              options={data.options}
              reasoning={data.reasoning || reasoning}
              customerValue={data.customerValue}
              selectedOffer={data.selectedOffer}
            />
          );
        }
        if (status === "error") return <ErrorCard label="Compensation" error={props.error} />;
        return null;
      },
    }),

    schedule_callback: tool({
      title: "Schedule callback",
      executingTitle: "Scheduling callback...",
      completedTitle: "Callback scheduled",
      description:
        "Schedule a phone callback with the customer. The agent picks an available time slot.",
      location: "client",
      needsApproval: true,
      approvalMessage: "Select a time slot for the callback",
      aiResponseMode: "none",
      aiContext: (result) => {
        const data = result.data as
          | { selectedSlot?: { date: string; time: string }; customerName: string }
          | undefined;
        return data?.selectedSlot
          ? `[Callback SCHEDULED: ${data.selectedSlot.date} at ${data.selectedSlot.time} with ${data.customerName}.]`
          : "[Callback scheduling cancelled by user]";
      },
      inputSchema: {
        type: "object",
        properties: {
          preferredDate: { type: "string", description: "Preferred date (optional hint)" },
          preferredTime: { type: "string", description: "Preferred time (optional hint)" },
        },
      },
      handler: async (_params, context) => {
        const selectedSlot = context?.approvalData?.selectedSlot as
          | { date: string; time: string; displayDate: string }
          | undefined;
        if (!selectedSlot) return { success: false, error: "No time slot selected" };
        dashboard.setCallbackScheduled({ date: selectedSlot.date, time: selectedSlot.time });
        const profile = profileFor(dashboard.getTicketDetail());
        return success({
          scheduled: true,
          selectedSlot,
          customerName: profile.name,
          phone: profile.phone,
        });
      },
      render: (props) => {
        const { status, approval, result } = props;
        const profile = profileFor(dashboard.ticketDetail);
        if (status === "approval-required" && approval) {
          return (
            <CallbackScheduledCard
              mode="select"
              customerName={profile.name}
              phone={profile.phone}
              onSelectSlot={(slot) => approval.onApprove({ selectedSlot: slot })}
              onCancel={() => approval.onReject("Cancelled by user")}
            />
          );
        }
        if (isLoading(status)) return <CallbackSkeleton />;
        if (status === "completed" && result?.data) {
          const data = result.data as {
            selectedSlot: { date: string; time: string; displayDate: string };
            customerName: string;
            phone: string;
          };
          return (
            <CallbackScheduledCard
              mode="confirmed"
              date={data.selectedSlot.displayDate || data.selectedSlot.date}
              time={data.selectedSlot.time}
              phone={data.phone}
              customerName={data.customerName}
            />
          );
        }
        if (status === "error") return <ErrorCard label="Scheduling" error={props.error} />;
        return null;
      },
    }),

    escalate_ticket: tool({
      title: (args) => `Escalate (${args.priority || "High"})`,
      executingTitle: "Assigning to supervisor...",
      completedTitle: "Ticket escalated",
      description:
        "Escalate the open ticket to a supervisor. The agent picks the supervisor before it completes.",
      location: "client",
      needsApproval: true,
      approvalMessage: "Select a supervisor to escalate this ticket to",
      aiResponseMode: "none",
      aiContext: (result) => {
        const data = result.data as
          | { supervisor: { name: string; role: string }; reason: string }
          | undefined;
        return data?.supervisor
          ? `[Escalation COMPLETED: escalated to ${data.supervisor.name} (${data.supervisor.role}). Reason: ${data.reason}.]`
          : "[Escalation failed or was cancelled]";
      },
      inputSchema: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Reason for escalation" },
          priority: { type: "string", description: "Priority level", enum: ["High", "Critical"] },
        },
        required: ["reason", "priority"],
      },
      handler: async (params, context) => {
        const supervisor = context?.approvalData?.supervisor as
          | { name: string; role: string }
          | undefined;
        if (!supervisor) return { success: false, error: "No supervisor selected" };
        dashboard.setEscalatedTo(`${supervisor.name} (${supervisor.role})`);
        return success({
          supervisor,
          reason: params.reason as string,
          priority: params.priority as string,
        });
      },
      render: (props) => {
        const { status, args, approval, result } = props;
        if (status === "approval-required" && approval) {
          return (
            <EscalationCard
              reason={args.reason as string}
              priority={args.priority as string}
              onAssign={(supervisor) => approval.onApprove({ supervisor })}
              onCancel={() => approval.onReject("Cancelled by user")}
            />
          );
        }
        if (isLoading(status)) return <EscalationSkeleton />;
        if (status === "completed" && result?.data) {
          const data = result.data as {
            supervisor: { name: string; role: string };
            reason: string;
            priority: string;
          };
          return (
            <EscalationCard
              reason={data.reason}
              priority={data.priority}
              initialAssigned={true}
              initialSupervisor={data.supervisor.name}
            />
          );
        }
        if (status === "error") return <ErrorCard label="Escalation" error={props.error} />;
        return null;
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return <TicketContext />;
}
