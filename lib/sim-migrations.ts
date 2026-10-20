// Schema history of data/sim.db. Append new migrations; never edit an applied one.

import type { Migration } from "./db";

export const SIM_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "tickets, messages, customers, email threading and outbox",
    // IF NOT EXISTS: databases created before migrations existed already have these tables
    up: (db) =>
      db.exec(`
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

        CREATE TABLE IF NOT EXISTS sim_email_ids (
          message_id TEXT PRIMARY KEY,     -- Message-ID of an inbound email
          ticket_id TEXT REFERENCES sim_tickets(id)
        );

        -- Agent email replies, keyed by the client's idempotency key, so a retry never emails twice
        CREATE TABLE IF NOT EXISTS sim_email_outbox (
          idem_key TEXT PRIMARY KEY,
          ticket_id TEXT REFERENCES sim_tickets(id),
          body TEXT,
          status TEXT DEFAULT 'sending',   -- sending | sent | failed (SES rejected it; safe to resend)
          message_id TEXT,                 -- SES Message-ID once SES accepted it
          error TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `),
  },
];
