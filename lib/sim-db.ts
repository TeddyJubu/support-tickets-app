// Writable store for simulated tickets (data/sim.db).
// The simulator (scripts/simulate.mjs) creates tickets and customer messages
// through app/api/helpdesk/sim/*; agents reply from the UI.
// Customers here are pseudonyms: no real names or emails are stored.

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type {
  Customer,
  CustomerStats,
  SimMessage,
  Ticket,
  TicketDetail,
  TicketSummary,
} from "./helpdesk-types";

type Row = Record<string, unknown>;

let db: DatabaseSync | null = null;

function getDb() {
  if (db) return db;
  db = new DatabaseSync(join(process.cwd(), "data/sim.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS sim_customers (
      id TEXT PRIMARY KEY,
      source_key TEXT UNIQUE,          -- sha256 of the real email; never the email itself
      first_name TEXT, last_name TEXT, email TEXT UNIQUE, phone TEXT,
      city TEXT, province TEXT, country TEXT,
      total_spent REAL DEFAULT 0, total_orders INTEGER DEFAULT 0,
      store_customer_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sim_tickets (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE,                  -- "SIM-<seq>"
      source_ticket_id TEXT,           -- historical ticket this was replayed from
      run_id TEXT,
      customer_id TEXT REFERENCES sim_customers(id),
      subject TEXT, priority TEXT DEFAULT 'normal', tags TEXT, ai_intent TEXT,
      order_name TEXT, order_id TEXT,
      status TEXT DEFAULT 'open',      -- open | pending | closed
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      first_response_at TEXT,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS sim_tickets_customer ON sim_tickets(customer_id);

    CREATE TABLE IF NOT EXISTS sim_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT REFERENCES sim_tickets(id),
      author TEXT,                     -- customer | agent | system
      sender TEXT,
      body TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS sim_messages_ticket ON sim_messages(ticket_id);
  `);
  return db;
}

const s = (v: unknown) => (v == null ? null : String(v));
// SQLite datetime('now') is UTC without a zone marker; return ISO 8601
const iso = (v: unknown) => (v == null ? null : `${String(v).replace(" ", "T")}Z`);
const n = (v: unknown) => (v == null ? 0 : Number(v));

const secondsBetween = (a: unknown, b: unknown) =>
  a && b
    ? Math.max(0, Math.round((Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 1000))
    : null;

export const isSimTicketId = (id: string) => /^SIM-\d+$/.test(id);

function counts(ticketId: string) {
  const r = getDb()
    .prepare(
      `SELECT sum(author = 'customer') AS c, sum(author = 'agent') AS a
       FROM sim_messages WHERE ticket_id = ?`,
    )
    .get(ticketId) as Row;
  return { customer: n(r.c), agent: n(r.a) };
}

function toSummary(r: Row): TicketSummary {
  const c = counts(String(r.id));
  return {
    id: String(r.id),
    subject: s(r.subject),
    customerName: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
    customerEmail: s(r.email),
    priority: s(r.priority),
    tags: s(r.tags),
    aiIntent: s(r.ai_intent),
    createdAt: iso(r.created_at),
    closedAt: iso(r.closed_at),
    agentMessages: c.agent,
    customerMessages: c.customer,
    simulated: true,
    status: s(r.status),
  };
}

function toTicket(r: Row): Ticket {
  return {
    ...toSummary(r),
    channel: "email",
    integration: "Simulator",
    createdByAgent: false,
    assigneeName: null,
    assigneeEmail: null,
    firstResponseSeconds: secondsBetween(r.created_at, r.first_response_at),
    resolutionSeconds: secondsBetween(r.created_at, r.closed_at),
    url: null,
    contactReason: null,
    product: null,
    resolution: null,
    sentiment: null,
    customerType: null,
    automated: false,
    orderName: s(r.order_name),
    sourceTicketId: s(r.source_ticket_id),
  };
}

function toCustomer(r: Row): Customer {
  return {
    id: String(r.customer_id ?? r.id),
    name: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
    firstName: s(r.first_name),
    lastName: s(r.last_name),
    email: s(r.email),
    phone: s(r.phone),
    company: null,
    address1: null,
    address2: null,
    city: s(r.city),
    province: s(r.province),
    country: s(r.country),
    zip: null,
    acceptsEmail: true,
    acceptsSms: false,
    totalSpent: n(r.total_spent),
    totalOrders: n(r.total_orders),
    note: "Simulated customer (pseudonym)",
    tags: "simulated",
    taxExempt: false,
  };
}

const TICKET_SELECT = `SELECT t.*, c.first_name, c.last_name, c.email
  FROM sim_tickets t LEFT JOIN sim_customers c ON c.id = t.customer_id`;

export function listSimTickets({
  q = "",
  offset = 0,
  limit = 50,
}: {
  q?: string;
  offset?: number;
  limit?: number;
}) {
  const like = `%${q.trim().toLowerCase()}%`;
  const where = q.trim()
    ? `WHERE lower(t.id) LIKE ? OR lower(t.subject) LIKE ? OR lower(c.first_name || ' ' || c.last_name) LIKE ?
       OR lower(c.email) LIKE ? OR lower(coalesce(t.order_name, '')) LIKE ?`
    : "";
  const params = q.trim() ? [like, like, like, like, like] : [];
  const total = n(
    getDb()
      .prepare(`SELECT count(*) AS c FROM sim_tickets t LEFT JOIN sim_customers c ON c.id = t.customer_id ${where}`)
      .get(...params)?.c,
  );
  const rows = getDb()
    .prepare(`${TICKET_SELECT} ${where} ORDER BY t.updated_at DESC, t.seq DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Row[];
  return { tickets: rows.map(toSummary), total, offset, limit };
}

export function getSimTicketDetail(id: string): TicketDetail | null {
  const r = getDb().prepare(`${TICKET_SELECT} WHERE t.id = ?`).get(id) as Row | undefined;
  if (!r) return null;
  const customerRow = getDb()
    .prepare(`SELECT * FROM sim_customers WHERE id = ?`)
    .get(String(r.customer_id)) as Row | undefined;
  const history = getDb()
    .prepare(`${TICKET_SELECT} WHERE t.customer_id = ? AND t.id <> ? ORDER BY t.seq DESC LIMIT 25`)
    .all(String(r.customer_id), id) as Row[];
  const messages = getDb()
    .prepare(`SELECT * FROM sim_messages WHERE ticket_id = ? ORDER BY id`)
    .all(id) as Row[];
  const all = getDb()
    .prepare(
      `SELECT created_at, first_response_at, closed_at, priority FROM sim_tickets WHERE customer_id = ?`,
    )
    .all(String(r.customer_id)) as Row[];
  const avg = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const stats: CustomerStats = {
    ticketCount: all.length,
    ticketsLast90Days: all.filter((t) => Date.parse(`${t.created_at}Z`) > Date.now() - 90 * 86400e3).length,
    criticalTickets: all.filter((t) => t.priority === "high" || t.priority === "critical").length,
    avgFirstResponseSeconds: avg(all.map((t) => secondsBetween(t.created_at, t.first_response_at))),
    avgResolutionSeconds: avg(all.map((t) => secondsBetween(t.created_at, t.closed_at))),
    topIntents: [],
  };
  return {
    ticket: toTicket(r),
    customer: customerRow ? toCustomer(customerRow) : null,
    history: history.map(toSummary),
    stats,
    messages: messages.map(
      (m): SimMessage => ({
        id: n(m.id),
        author: String(m.author) as SimMessage["author"],
        sender: s(m.sender),
        body: String(m.body ?? ""),
        createdAt: iso(m.created_at)!,
      }),
    ),
  };
}

export interface SimCustomerInput {
  sourceKey: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  totalSpent?: number;
  totalOrders?: number;
  storeCustomerId?: string | null;
}

export function upsertSimCustomer(input: SimCustomerInput) {
  const existing = getDb()
    .prepare(`SELECT id FROM sim_customers WHERE source_key = ?`)
    .get(input.sourceKey) as Row | undefined;
  if (existing) {
    getDb()
      .prepare(
        `UPDATE sim_customers SET total_spent = ?, total_orders = ?,
           store_customer_id = coalesce(?, store_customer_id) WHERE id = ?`,
      )
      .run(input.totalSpent ?? 0, input.totalOrders ?? 0, input.storeCustomerId ?? null, String(existing.id));
    return String(existing.id);
  }
  const id = `simcust-${input.sourceKey.slice(0, 12)}`;
  getDb()
    .prepare(
      `INSERT INTO sim_customers (id, source_key, first_name, last_name, email, phone, city, province, country,
         total_spent, total_orders, store_customer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id, input.sourceKey, input.firstName, input.lastName, input.email, input.phone ?? null,
      input.city ?? null, input.province ?? null, input.country ?? null,
      input.totalSpent ?? 0, input.totalOrders ?? 0, input.storeCustomerId ?? null,
    );
  return id;
}

export interface SimTicketInput {
  customer: SimCustomerInput;
  subject: string;
  body: string;
  priority?: string;
  tags?: string | null;
  aiIntent?: string | null;
  orderName?: string | null;
  orderId?: string | null;
  sourceTicketId?: string | null;
  runId?: string | null;
}

export function createSimTicket(input: SimTicketInput) {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const customerId = upsertSimCustomer(input.customer);
    const res = d
      .prepare(
        `INSERT INTO sim_tickets (customer_id, subject, priority, tags, ai_intent, order_name, order_id,
           source_ticket_id, run_id) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        customerId, input.subject, input.priority ?? "normal", input.tags ?? null, input.aiIntent ?? null,
        input.orderName ?? null, input.orderId ?? null, input.sourceTicketId ?? null, input.runId ?? null,
      );
    const id = `SIM-${1000 + Number(res.lastInsertRowid)}`;
    d.prepare(`UPDATE sim_tickets SET id = ? WHERE seq = ?`).run(id, Number(res.lastInsertRowid));
    d.prepare(`INSERT INTO sim_messages (ticket_id, author, sender, body) VALUES (?, 'customer', ?, ?)`).run(
      id,
      `${input.customer.firstName} ${input.customer.lastName}`,
      input.body,
    );
    d.exec("COMMIT");
    return id;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

export function addSimMessage(
  ticketId: string,
  author: "customer" | "agent" | "system",
  body: string,
  sender?: string | null,
) {
  const d = getDb();
  const ticket = d.prepare(`SELECT * FROM sim_tickets WHERE id = ?`).get(ticketId) as Row | undefined;
  if (!ticket) return null;
  d.prepare(`INSERT INTO sim_messages (ticket_id, author, sender, body) VALUES (?,?,?,?)`).run(
    ticketId, author, sender ?? null, body,
  );
  if (author === "agent") {
    d.prepare(
      `UPDATE sim_tickets SET status = 'pending', updated_at = datetime('now'),
         first_response_at = coalesce(first_response_at, datetime('now')) WHERE id = ?`,
    ).run(ticketId);
  } else if (author === "customer") {
    // A customer reply reopens the ticket
    d.prepare(
      `UPDATE sim_tickets SET status = 'open', closed_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).run(ticketId);
  }
  return getSimTicketDetail(ticketId);
}

export function setSimTicketStatus(ticketId: string, status: "open" | "pending" | "closed") {
  const res = getDb()
    .prepare(
      `UPDATE sim_tickets SET status = ?, updated_at = datetime('now'),
         closed_at = CASE WHEN ? = 'closed' THEN datetime('now') ELSE NULL END WHERE id = ?`,
    )
    .run(status, status, ticketId);
  return res.changes > 0 ? getSimTicketDetail(ticketId) : null;
}

// Tickets waiting on the customer (agent replied last) — used by the simulator for follow-ups
export function ticketsAwaitingCustomer(limit = 20) {
  const rows = getDb()
    .prepare(
      `${TICKET_SELECT} WHERE t.status = 'pending' ORDER BY t.updated_at ASC LIMIT ?`,
    )
    .all(limit) as Row[];
  return rows.map((r) => getSimTicketDetail(String(r.id))!);
}

// Order names the simulator attached to tickets (the helpdesk only looks these up in the store)
export function isSimOrder(orderName: string) {
  return Boolean(
    getDb().prepare(`SELECT 1 FROM sim_tickets WHERE order_name = ? LIMIT 1`).get(orderName),
  );
}
