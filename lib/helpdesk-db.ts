// Server-only access to the seeded helpdesk database (data/helpdesk.db).
// Seed it with `npm run seed`.

import { DatabaseSync } from "node:sqlite";
import { dataDir } from "./db";
import { join } from "node:path";
import type {
  Customer,
  CustomerStats,
  Product,
  SimilarTicket,
  Ticket,
  TicketDetail,
  TicketListResponse,
  TicketSummary,
} from "./helpdesk-types";

type Row = Record<string, unknown>;

let db: DatabaseSync | null = null;
function getDb() {
  db ??= new DatabaseSync(join(dataDir(), "helpdesk.db"), {
    readOnly: true,
  });
  return db;
}

const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? 0 : Number(v));
const nOrNull = (v: unknown) => (v == null ? null : Number(v));

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have i in is it me my of on or our re fw fwd please the this to was we what when where which will with you your order hi hello".split(
    " ",
  ),
);

function tokens(text: string | null | undefined, { dropNumbers = false } = {}) {
  return (text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .filter((t) => !(dropNumbers && /^\d{3,}$/.test(t)));
}

// Turn free text into a safe FTS5 query: every token must match (prefix match)
function ftsQuery(text: string, mode: "AND" | "OR" = "AND") {
  const toks = tokens(text).slice(0, 12);
  if (!toks.length) return null;
  return toks.map((t) => `"${t.replace(/"/g, "")}"*`).join(` ${mode} `);
}

const TICKET_SUMMARY_COLS = `t.id, t.subject, t.customer_name, t.customer_email, t.priority, t.tags,
  t.ai_intent, t.created_at, t.closed_at, t.agent_messages, t.customer_messages`;

function toSummary(r: Row): TicketSummary {
  return {
    id: String(r.id),
    subject: s(r.subject),
    customerName: s(r.customer_name),
    customerEmail: s(r.customer_email),
    priority: s(r.priority),
    tags: s(r.tags),
    aiIntent: s(r.ai_intent),
    createdAt: s(r.created_at),
    closedAt: s(r.closed_at),
    agentMessages: n(r.agent_messages),
    customerMessages: n(r.customer_messages),
  };
}

function toTicket(r: Row): Ticket {
  return {
    ...toSummary(r),
    channel: s(r.channel),
    integration: s(r.integration),
    createdByAgent: Boolean(r.created_by_agent),
    assigneeName: s(r.assignee_name),
    assigneeEmail: s(r.assignee_email),
    firstResponseSeconds: nOrNull(r.first_response_s),
    resolutionSeconds: nOrNull(r.resolution_s),
    url: s(r.url),
    contactReason: s(r.contact_reason),
    product: s(r.product),
    resolution: s(r.resolution),
    sentiment: s(r.sentiment),
    customerType: s(r.customer_type),
    automated: Boolean(r.automated),
  };
}

function toCustomer(r: Row): Customer {
  return {
    id: String(r.id),
    name: s(r.name),
    firstName: s(r.first_name),
    lastName: s(r.last_name),
    email: s(r.email),
    phone: s(r.phone),
    company: s(r.company),
    address1: s(r.address1),
    address2: s(r.address2),
    city: s(r.city),
    province: s(r.province),
    country: s(r.country),
    zip: s(r.zip),
    acceptsEmail: Boolean(r.accepts_email),
    acceptsSms: Boolean(r.accepts_sms),
    totalSpent: n(r.total_spent),
    totalOrders: n(r.total_orders),
    note: s(r.note),
    tags: s(r.tags),
    taxExempt: Boolean(r.tax_exempt),
  };
}

function toProduct(r: Row): Product {
  return {
    handle: String(r.handle),
    title: s(r.title),
    vendor: s(r.vendor),
    category: s(r.category),
    type: s(r.type),
    tags: s(r.tags),
    status: s(r.status),
    published: Boolean(r.published),
    description: s(r.description),
    image: s(r.image),
    priceMin: nOrNull(r.price_min),
    priceMax: nOrNull(r.price_max),
    compareAtMax: nOrNull(r.compare_at_max),
    variantCount: n(r.variant_count),
    inventory: n(r.inventory),
    options: s(r.options),
    finalSale: Boolean(r.final_sale),
  };
}

export function listTickets({
  q = "",
  offset = 0,
  limit = 50,
  includeAutomated = false,
}: {
  q?: string;
  offset?: number;
  limit?: number;
  includeAutomated?: boolean;
}): TicketListResponse {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const match = ftsQuery(q);
  let from = "tickets t";
  if (/^\d+$/.test(q.trim())) {
    where.push("t.id = ?");
    params.push(q.trim());
  } else if (match) {
    from = "tickets_fts f JOIN tickets t ON t.id = f.id";
    where.push("tickets_fts MATCH ?");
    params.push(match);
  }
  if (!includeAutomated) where.push("t.automated = 0 AND t.customer_messages > 0");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = n(
    getDb().prepare(`SELECT count(*) AS c FROM ${from} ${whereSql}`).get(...params)?.c,
  );
  const rows = getDb()
    .prepare(
      `SELECT ${TICKET_SUMMARY_COLS} FROM ${from} ${whereSql}
       ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Row[];
  return { tickets: rows.map(toSummary), total, offset, limit };
}

function customerStats(email: string | null): CustomerStats {
  if (!email) {
    return {
      ticketCount: 0,
      ticketsLast90Days: 0,
      criticalTickets: 0,
      avgFirstResponseSeconds: null,
      avgResolutionSeconds: null,
      topIntents: [],
    };
  }
  const agg = getDb()
    .prepare(
      `SELECT count(*) AS c,
         sum(created_at >= datetime('now', '-90 days')) AS recent,
         sum(priority IN ('critical', 'high')) AS critical,
         avg(first_response_s) AS frt, avg(resolution_s) AS rt
       FROM tickets WHERE customer_email = ?`,
    )
    .get(email) as Row;
  const intents = getDb()
    .prepare(
      `SELECT ai_intent AS intent, count(*) AS c FROM tickets
       WHERE customer_email = ? AND ai_intent IS NOT NULL AND ai_intent NOT LIKE 'Other::No Reply%'
       GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
    )
    .all(email) as Row[];
  return {
    ticketCount: n(agg.c),
    ticketsLast90Days: n(agg.recent),
    criticalTickets: n(agg.critical),
    avgFirstResponseSeconds: agg.frt == null ? null : Math.round(Number(agg.frt)),
    avgResolutionSeconds: agg.rt == null ? null : Math.round(Number(agg.rt)),
    topIntents: intents.map((r) => ({ intent: String(r.intent), count: n(r.c) })),
  };
}

export function getCustomerByEmail(email: string | null): Customer | null {
  if (!email) return null;
  const r = getDb()
    .prepare(`SELECT * FROM customers WHERE email = ? ORDER BY total_spent DESC LIMIT 1`)
    .get(email.toLowerCase()) as Row | undefined;
  return r ? toCustomer(r) : null;
}

export function getTicketDetail(id: string): TicketDetail | null {
  const r = getDb().prepare(`SELECT * FROM tickets t WHERE t.id = ?`).get(id) as
    | Row
    | undefined;
  if (!r) return null;
  const ticket = toTicket(r);
  const history = ticket.customerEmail
    ? (getDb()
        .prepare(
          `SELECT ${TICKET_SUMMARY_COLS} FROM tickets t
           WHERE t.customer_email = ? AND t.id <> ?
           ORDER BY t.created_at DESC LIMIT 25`,
        )
        .all(ticket.customerEmail, id) as Row[])
    : [];
  return {
    ticket,
    customer: getCustomerByEmail(ticket.customerEmail),
    history: history.map(toSummary),
    stats: customerStats(ticket.customerEmail),
  };
}

export function findSimilarTickets(id: string, limit = 5): SimilarTicket[] {
  const base = getDb().prepare(`SELECT * FROM tickets WHERE id = ?`).get(id) as
    | Row
    | undefined;
  if (!base) return [];
  const intent = s(base.ai_intent);
  const useIntent = intent && !intent.startsWith("Other::");
  const baseTokens = new Set(tokens(s(base.subject), { dropNumbers: true }));

  const candidates = new Map<string, Row>();
  const add = (rows: Row[]) => rows.forEach((r) => candidates.set(String(r.id), r));
  const cols = `${TICKET_SUMMARY_COLS}, t.resolution_s`;
  const filter = `t.id <> ? AND t.automated = 0 AND t.customer_messages > 0 AND t.agent_messages > 0`;

  const match = ftsQuery([...baseTokens].join(" "), "OR");
  if (match) {
    add(
      getDb()
        .prepare(
          `SELECT ${cols} FROM tickets_fts f JOIN tickets t ON t.id = f.id
           WHERE tickets_fts MATCH ? AND ${filter} ORDER BY bm25(tickets_fts) LIMIT 150`,
        )
        .all(match, id) as Row[],
    );
  }
  if (useIntent) {
    add(
      getDb()
        .prepare(
          `SELECT ${cols} FROM tickets t WHERE t.ai_intent = ? AND ${filter}
           ORDER BY t.created_at DESC LIMIT 150`,
        )
        .all(intent, id) as Row[],
    );
  }

  return [...candidates.values()]
    .map((r) => {
      const toks = new Set(tokens(s(r.subject), { dropNumbers: true }));
      const overlap = [...toks].filter((t) => baseTokens.has(t)).length;
      const union = new Set([...toks, ...baseTokens]).size || 1;
      const textScore = overlap / union;
      const intentScore = useIntent && s(r.ai_intent) === intent ? 1 : 0;
      const similarity = Math.round(
        useIntent ? 45 * intentScore + 54 * textScore : 99 * textScore,
      );
      return { ...toSummary(r), resolutionSeconds: nOrNull(r.resolution_s), similarity };
    })
    .filter((t) => t.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export const isProductHandle = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,199}$/.test(v);

/** One catalog product by handle; null when it's unknown or the catalog isn't seeded */
export function getProduct(handle: string): Product | null {
  try {
    const r = getDb().prepare(`SELECT * FROM products WHERE handle = ?`).get(handle) as Row | undefined;
    return r ? toProduct(r) : null;
  } catch {
    return null;
  }
}

export function searchProducts(q: string, limit = 8): Product[] {
  const match = ftsQuery(q);
  if (!match) return [];
  const rows = getDb()
    .prepare(
      `SELECT p.* FROM products_fts f JOIN products p ON p.handle = f.handle
       WHERE products_fts MATCH ? ORDER BY bm25(products_fts, 0, 10, 3, 2, 2, 1, 4, 1) LIMIT ?`,
    )
    .all(match, limit) as Row[];
  return rows.map(toProduct);
}

export function searchCustomers(q: string, limit = 8): Customer[] {
  const trimmed = q.trim().toLowerCase();
  if (trimmed.includes("@")) {
    const rows = getDb()
      .prepare(`SELECT * FROM customers WHERE email = ? LIMIT ?`)
      .all(trimmed, limit) as Row[];
    if (rows.length) return rows.map(toCustomer);
  }
  const match = ftsQuery(q);
  if (!match) return [];
  const rows = getDb()
    .prepare(
      `SELECT c.* FROM customers_fts f JOIN customers c ON c.id = f.id
       WHERE customers_fts MATCH ? ORDER BY bm25(customers_fts), c.total_spent DESC LIMIT ?`,
    )
    .all(match, limit) as Row[];
  return rows.map(toCustomer);
}

/** Active, published catalog products (for the KB product sync) */
export function catalogProducts() {
  return getDb()
    .prepare(
      `SELECT handle, title, vendor, type, tags, description, price_min, price_max, options, inventory, final_sale
       FROM products WHERE status = 'active' AND published = 1 ORDER BY vendor, title`,
    )
    .all() as Array<Record<string, unknown>>;
}
