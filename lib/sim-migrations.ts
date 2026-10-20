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
  {
    version: 2,
    name: "staff accounts, sessions, login attempts, audit log",
    up: (db) =>
      db.exec(`
        CREATE TABLE staff_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name TEXT NOT NULL,
          email TEXT,
          role TEXT NOT NULL DEFAULT 'agent',      -- owner | agent
          password_hash TEXT NOT NULL,             -- pbkdf2$<iterations>$<salt>$<hash>
          created_at TEXT DEFAULT (datetime('now')),
          disabled_at TEXT
        );

        -- Only a SHA-256 of each session token is stored
        CREATE TABLE staff_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES staff_users(id),
          created_at TEXT DEFAULT (datetime('now')),
          last_seen_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL
        );
        CREATE INDEX staff_sessions_user ON staff_sessions(user_id);

        CREATE TABLE login_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip TEXT, username TEXT, ok INTEGER NOT NULL,
          at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX login_attempts_at ON login_attempts(at);

        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT DEFAULT (datetime('now')),
          actor TEXT NOT NULL,                     -- staff username, "simulator", "worker", "cli"
          action TEXT NOT NULL,
          ticket_id TEXT,
          detail TEXT                              -- JSON
        );
        CREATE INDEX audit_log_ticket ON audit_log(ticket_id, id);
      `),
  },
  {
    version: 3,
    name: "triage: channel, assignee, snooze, trash, spam, tags, read state, notes, attachments",
    up: (db) => {
      db.exec(`
        ALTER TABLE sim_tickets ADD COLUMN channel TEXT NOT NULL DEFAULT 'simulator'; -- simulator | email | staff
        ALTER TABLE sim_tickets ADD COLUMN assignee_id INTEGER REFERENCES staff_users(id);
        ALTER TABLE sim_tickets ADD COLUMN snoozed_until TEXT;
        ALTER TABLE sim_tickets ADD COLUMN trashed_at TEXT;
        ALTER TABLE sim_tickets ADD COLUMN spam_at TEXT;
        UPDATE sim_tickets SET channel = 'email' WHERE tags = 'email';
        CREATE INDEX sim_tickets_status ON sim_tickets(status, updated_at);
        CREATE INDEX sim_tickets_assignee ON sim_tickets(assignee_id);

        CREATE TABLE ticket_tags (
          ticket_id TEXT NOT NULL REFERENCES sim_tickets(id),
          tag TEXT NOT NULL COLLATE NOCASE,
          PRIMARY KEY (ticket_id, tag)
        );
        CREATE INDEX ticket_tags_tag ON ticket_tags(tag);

        -- Per staff member: when they last read the ticket (unread = a newer customer message)
        CREATE TABLE ticket_reads (
          ticket_id TEXT NOT NULL REFERENCES sim_tickets(id),
          user_id INTEGER NOT NULL REFERENCES staff_users(id),
          read_at TEXT NOT NULL,
          PRIMARY KEY (ticket_id, user_id)
        );

        -- author 'note': internal staff note, never sent to the customer
        ALTER TABLE sim_messages ADD COLUMN truncated INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id TEXT NOT NULL REFERENCES sim_tickets(id),
          message_id INTEGER REFERENCES sim_messages(id),
          filename TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          stored INTEGER NOT NULL DEFAULT 1,       -- 0: too large or not allowed, metadata only
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX attachments_message ON attachments(message_id);
      `);
      // Source tags from replayed tickets ("a, b, c") become rows; "email" was a channel marker
      const rows = db.prepare(`SELECT id, tags FROM sim_tickets WHERE tags IS NOT NULL AND tags != 'email'`).all() as Array<{
        id: string;
        tags: string;
      }>;
      const insert = db.prepare(`INSERT OR IGNORE INTO ticket_tags (ticket_id, tag) VALUES (?, ?)`);
      for (const r of rows) {
        for (const tag of r.tags.split(",").map((t) => t.trim().toLowerCase()).filter((t) => t && t !== "auto-close")) {
          insert.run(r.id, tag.slice(0, 40));
        }
      }
    },
  },
];
