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
  {
    version: 4,
    name: "notice board",
    up: (db) =>
      db.exec(`
        -- Short owner notices ("warehouse closed Friday") that override the knowledge base
        CREATE TABLE notices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT,                         -- NULL: until ended
          ended_at TEXT,
          ended_by TEXT
        );
      `),
  },
  {
    version: 5,
    name: "AI drafting: job queue, drafts, worker state",
    up: (db) =>
      db.exec(`
        -- One job per customer message that needs a draft. A newer customer message
        -- supersedes waiting jobs for the same ticket.
        CREATE TABLE jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL DEFAULT 'draft',
          ticket_id TEXT NOT NULL REFERENCES sim_tickets(id),
          message_id INTEGER,                      -- the customer message to answer
          state TEXT NOT NULL DEFAULT 'pending',   -- pending | processing | retry_wait | done | failed | superseded | skipped
          urgent INTEGER NOT NULL DEFAULT 0,       -- sensitive high/critical: may jump the queue
          attempts INTEGER NOT NULL DEFAULT 0,
          run_after TEXT NOT NULL DEFAULT (datetime('now')),
          claimed_at TEXT,
          claimed_by TEXT,
          error TEXT,
          error_kind TEXT,                         -- transient | auth | invalid | safety | stale
          detail TEXT,                             -- JSON (classifier result, skip reason)
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          finished_at TEXT
        );
        CREATE INDEX jobs_state ON jobs(state, run_after, id);
        CREATE INDEX jobs_ticket ON jobs(ticket_id, id);

        CREATE TABLE drafts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id TEXT NOT NULL REFERENCES sim_tickets(id),
          job_id INTEGER UNIQUE REFERENCES jobs(id),
          message_id INTEGER,
          body TEXT NOT NULL,                      -- empty when staff must write the reply
          action TEXT NOT NULL,                    -- reply | needs_staff
          severity TEXT NOT NULL DEFAULT 'normal',
          sensitive INTEGER NOT NULL DEFAULT 0,
          missing_facts TEXT,                      -- JSON list
          staff_next_step TEXT,
          flags TEXT,                              -- JSON list of cleaner/classifier notes
          kb_refs TEXT,                            -- JSON list of article titles used
          state TEXT NOT NULL DEFAULT 'ready',     -- ready | used | dismissed | superseded
          model TEXT,
          acted_by TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX drafts_ticket ON drafts(ticket_id, id);

        -- Heartbeat and last-run times of scheduled tasks
        CREATE TABLE worker_state (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `),
  },
  {
    version: 6,
    name: "safe sending: send intents for every channel, send grants, reviews",
    up: (db) =>
      db.exec(`
        -- sim_email_outbox becomes the send-intent log for every reply (email and simulated)
        ALTER TABLE sim_email_outbox ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';
        ALTER TABLE sim_email_outbox ADD COLUMN recipient TEXT;
        ALTER TABLE sim_email_outbox ADD COLUMN source_message_id INTEGER;
        ALTER TABLE sim_email_outbox ADD COLUMN actor TEXT;
        ALTER TABLE sim_email_outbox ADD COLUMN resolved_by TEXT;   -- staff who settled an uncertain send
        CREATE INDEX sim_email_outbox_ticket ON sim_email_outbox(ticket_id, status);

        -- "Read & write": a 30-minute permission to send, bound to one browser session
        CREATE TABLE send_grants (
          session_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES staff_users(id),
          created_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL
        );

        -- What the staff member reviewed before confirming: the send must still match it
        CREATE TABLE send_reviews (
          token_hash TEXT PRIMARY KEY,
          ticket_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          recipient TEXT NOT NULL,
          source_message_id INTEGER,
          created_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          used_at TEXT
        );
      `),
  },
  {
    version: 7,
    name: "customer rail: store snapshots, simulated returns",
    up: (db) =>
      db.exec(`
        -- Last successful read of the demo store for a ticket (shown when the store is slow or down)
        CREATE TABLE store_snapshots (
          ticket_id TEXT PRIMARY KEY REFERENCES sim_tickets(id),
          data TEXT NOT NULL,                      -- JSON
          fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_error TEXT,
          last_error_at TEXT
        );

        -- Returns and exchanges for simulated orders (stands in for Redo in this test system)
        CREATE TABLE sim_returns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id TEXT REFERENCES sim_tickets(id),
          customer_id TEXT REFERENCES sim_customers(id),
          order_name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'return',     -- return | exchange
          status TEXT NOT NULL DEFAULT 'requested',-- requested | label_sent | in_transit | received | refunded | exchanged | rejected
          items TEXT NOT NULL DEFAULT '[]',        -- JSON list of item titles
          refund_amount REAL,
          store_credit REAL,
          exchange_for TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX sim_returns_order ON sim_returns(order_name);
      `),
  },
  {
    version: 8,
    name: "learning loop: lessons from delivered replies",
    up: (db) =>
      db.exec(`
        -- One per delivered staff reply. Raw text (may contain personal data) never goes into the
        -- KB: only owner-approved lessons are masked and promoted nightly.
        CREATE TABLE lessons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id TEXT NOT NULL REFERENCES sim_tickets(id),
          send_key TEXT UNIQUE,                    -- the send intent it came from
          subject TEXT,
          intent TEXT,
          customer_message TEXT NOT NULL,
          ai_draft TEXT,                           -- the AI draft for that message, if any
          final_text TEXT NOT NULL,                -- what was delivered
          edited INTEGER NOT NULL DEFAULT 0,       -- final differs from the AI draft
          customer_names TEXT,                     -- JSON, for masking
          created_by TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | promoted
          reviewed_by TEXT,
          reviewed_at TEXT,
          promoted_at TEXT,
          kb_path TEXT
        );
        CREATE INDEX lessons_status ON lessons(status, id);
      `),
  },
  {
    version: 9,
    name: "notifications and owner alerts",
    up: (db) =>
      db.exec(`
        CREATE TABLE notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES staff_users(id),
          kind TEXT NOT NULL,                      -- reply | assigned | urgent | alert
          ticket_id TEXT,
          text TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          read_at TEXT
        );
        CREATE INDEX notifications_user ON notifications(user_id, read_at, id);

        -- Owner alerts (email). dedupe_key keeps one alert per event; every attempt is logged.
        CREATE TABLE alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,                      -- urgent_ticket | worker_down | worker_recovered | test
          ticket_id TEXT,
          severity TEXT,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          dedupe_key TEXT UNIQUE,
          status TEXT NOT NULL DEFAULT 'pending',  -- pending | sending | sent | failed | skipped
          attempts INTEGER NOT NULL DEFAULT 0,
          recipient TEXT,
          last_error TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          sent_at TEXT,
          next_attempt_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX alerts_status ON alerts(status, next_attempt_at);
      `),
  },
  {
    version: 10,
    name: "sender verification for store lookups",
    up: (db) =>
      db.exec(`
        -- 1: the sender passed DMARC, or staff opened the ticket; 0: a message failed; NULL: unknown
        ALTER TABLE sim_tickets ADD COLUMN sender_verified INTEGER;
      `),
  },
  {
    version: 11,
    name: "shopify store connected from settings",
    up: (db) =>
      db.exec(`
        -- At most one store. Tokens are encrypted (lib/shopify-tokens.ts); times in ms since epoch
        CREATE TABLE shopify_connection (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          -- the myshopify subdomain (cute-things), and the store's own name
          shop TEXT NOT NULL,
          shop_name TEXT,
          scopes TEXT,
          -- connected | reconnect (Shopify refused the keys, or they can't be read here)
          status TEXT NOT NULL,
          access_token TEXT,
          access_expires_at INTEGER,
          refresh_token TEXT,
          refresh_expires_at INTEGER,
          -- a process is refreshing the token until this time
          refreshing_until INTEGER,
          last_error TEXT,
          connected_by TEXT,
          connected_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        -- Shopify webhook deliveries already handled (Shopify may deliver one more than once)
        CREATE TABLE shopify_webhooks (
          id TEXT PRIMARY KEY,
          topic TEXT NOT NULL,
          shop TEXT,
          received_at TEXT DEFAULT (datetime('now'))
        );
      `),
  },
  {
    version: 12,
    name: "catalog product on simulated tickets",
    up: (db) =>
      db.exec(`
        -- Simulated tickets: the catalog product (helpdesk.db products.handle) the customer writes about
        ALTER TABLE sim_tickets ADD COLUMN product_handle TEXT;
      `),
  },
];
