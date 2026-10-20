# Port plan: Shopify helpdesk features → this helpdesk

Goal: bring the features of `/home/ubuntu/Shopify-help-desk` (production, Python + Hermes) into this app (Next.js + `node:sqlite` + Workers AI), **excluding everything Gorgias**. "Cleanly" means: rebuild each feature in this app's own stack and conventions, copy only data/content (KB articles, classifier rules, test scenarios), and never run or depend on the Python services.

Source survey: four read-only agent reviews of the Shopify repo (2026-10-19), spot-checked against its files.

## Ground rules for every task

- Same stack: TypeScript in `app/` and `lib/`, Node scripts in `scripts/`, data in `data/*.db`. No Python, no Hermes, no new database server.
- Schema changes go through one migration helper (task 0.1), never ad-hoc `CREATE TABLE` edits.
- Existing hard rules still apply (AGENTS.md): no secrets printed; only simulated rows in the demo store; no public endpoint that exposes store or customer data; ask before Caddy/systemd/Cloudflare changes or data resets.
- Every task ends with: tests for it, `npm run lint`, `npm run build`, and an updated `reference.md` / CLI if the operator surface changed.
- One PR per phase (or per task for the big ones), merged in phase order.

## Out of scope (not ported)

| Shopify-app feature | Why |
|---|---|
| Gorgias webhook intake, signature checks, reconciliation sweep | Gorgias excluded. Our channels stay: simulator + SES email. |
| Gorgias read-only MCP tool, Gorgias send / internal notes | Gorgias excluded. Sending uses our own email/sim channels. |
| Browser-local "local:UUID" tickets and localStorage-only labels | Only existed because Gorgias was read-only. We own our tickets, so state is stored server-side. |
| Hermes runtime, SOUL/skill files as code | Replaced by a Workers AI drafter in TypeScript. The persona/grounding rules are rewritten as our system prompt. |
| Warehouse safety patch, Shopify content-write monitor | Belong to a different app. |
| Retired feedback collector, Fable prototype | Retired upstream. |
| Live Shopify Admin API, live Redo API | This is a test system: Shopify data comes from the demo store (D1) and exports; returns are simulated (see 6.3). |

## Decisions to confirm before starting

1. **Login for the whole site.** Today the site is public. Several features (customer rail, KB editor, send gating) only make sense behind a login. Proposal: app-level login in Next.js (no Caddy change), simulator keeps its bearer key.
2. **Background worker as a second systemd service** (`support-tickets-worker`) for the AI drafter, nightly jobs and backups. Needs your OK (systemd change).
3. **Owner alerts channel.** Proposal: email via SES first (already set up); WhatsApp (Baileys QR pairing like the Shopify app) as an optional later task.
4. **Returns.** No Redo here. Proposal: the simulator creates simulated return records for Return/Exchange tickets, shown in the rail like Redo data.
5. **CI / auto-deploy.** CI on GitHub Actions for `TeddyJubu/support-tickets-app`: yes. Auto-deploy to this VPS: optional, last.

## Phases

Order matters: each phase only depends on earlier ones. Sizes: S ≈ under half a day, M ≈ 1 day, L ≈ 2–3 days.

### Phase 0 — Foundations

- [x] **0.1 Migrations (S).** `lib/migrations.ts`: numbered migrations for `sim.db`, applied on startup and by `npm run migrate`; record version in a `schema_version` table. Move the current `CREATE TABLE`s in `lib/sim-db.ts` into migration 1. Done when a fresh and an existing `sim.db` both end at the same schema.
- [x] **0.2 Test runner (S).** Node's built-in test runner (`node --test`) with `scripts/register-ts.mjs` so plain Node runs the app's TypeScript; every test file gets a scratch `HELPDESK_DATA_DIR`. `scripts/test-email-reply.mjs` moved into `tests/`. `npm test`.
- [x] **0.3 CI (S).** `.github/workflows/ci.yml`: install, lint, typecheck, `npm test`, `npm run build`. Plus a secret scan step (committed `.env*`, key-like strings), modelled on the Shopify `pr-review.yml`.
- [x] **0.4 Health endpoints (S).** `GET /api/health` (process up) and `GET /api/ready` (DB opens, schema at latest, worker heartbeat fresh once Phase 4 lands). No data in responses. `helpdesk status` uses them.

### Phase 1 — Staff login

- [x] **1.1 Accounts and sessions (M).** Tables `staff_users` (PBKDF2 hash via `node:crypto`) and `staff_sessions` (random token, hashed at rest, expiry). `npm run helpdesk -- user add <name>` prompts for a password; never echoes it.
- [x] **1.2 Login page and gate (M).** `/login`, signed HttpOnly cookie, Next.js proxy/middleware protecting every page and `/api/*` except `/api/health`, `/api/ready`, the SES inbound route (own token) and the simulator routes (bearer key). "Sign in to continue" on expiry.
- [x] **1.3 Login rate limit (S).** Per-IP and per-username attempt limits stored in SQLite.
- [x] **1.4 Staff identity everywhere (S).** Agent replies, status changes and audit rows record the signed-in user. Enables "Assigned to me".

### Phase 2 — Inbox triage

- [x] **2.1 Ticket fields (S).** Migration: `assignee`, `snoozed_until`, `read_at`, `trashed_at`, `spam`, `tags` (normalized table). Priority stays `low | normal | high | critical`.
- [x] **2.2 Views (M).** All, Open, Pending, Assigned to me, Unassigned, Snoozed, Closed, Trash, Spam, with counts. Server-side queries in `/api/helpdesk/tickets`.
- [x] **2.3 Filters, sort, paging (M).** Priority, assignee, tag, channel (sim/email); newest/oldest; 25 per page with page controls.
- [x] **2.4 Ticket actions (M).** Set priority, assignee, tags; snooze (until a time, auto-wakes); mark read/unread; trash/restore; spam. Each writes an audit row.
- [x] **2.5 Bulk actions (S).** Select page → status, priority, assignee, read state, snooze.
- [x] **2.6 New ticket (S).** Staff create a ticket for a customer email (real, stored in `sim.db`), optionally sending the first email.
- [x] **2.7 Thread detail (M).** Older-message paging, quoted-history collapse, image attachments from inbound email (store attachment files under `data/attachments/`, served only to signed-in staff), truncation notice.

### Phase 3 — Knowledge base

- [ ] **3.1 Import KB content (S).** Copy `kb/intents`, `kb/faq`, `kb/policies`, `kb/tickets` markdown (51 files) into `kb/` here. Do **not** copy `kb/learned` or notices (may hold customer text). Keep their front-matter conventions (`kb/CONVENTIONS.md`).
- [ ] **3.2 Index (M).** `data/kb.db`: documents + chunks, SQLite FTS5 for keywords, embeddings from Workers AI (`@cf/baai/bge-m3`, multilingual incl. Hebrew) stored as blobs. Rebuild is atomic: build a new file, validate counts, then swap; keep the last good index on failure.
- [ ] **3.3 Hybrid search (M).** Keyword + vector results fused with reciprocal-rank fusion, category weights, `[SENSITIVE → escalate]` flag from front-matter. `lib/kb-search.ts` + `GET /api/kb/search`.
- [ ] **3.4 Product sync (S).** Generate product KB docs from the demo store D1 catalog / product export, daily, same atomic swap.
- [ ] **3.5 KB editor (L).** Console page: list with search and category filter, Preview/Edit, Save with dirty-state guard, New article, Reindex with status polling. Writes only inside allowed folders; every save keeps the previous version (20-version ring in `kb/.backups/`).
- [ ] **3.6 Notice Board (M).** Short owner notices that override KB answers, optional expiry, "review before publishing" step, end-now with confirmation, reuse expired. Expired notices cleaned by the worker.
- [ ] **3.7 Real KB tool in the copilot (S).** Replace the mock knowledge-base results with `search_kb`, citing article titles.

### Phase 4 — Automatic AI drafts (background pipeline)

- [ ] **4.1 Job queue (M).** `jobs` table: atomic pending→processing claim, completion only with a committed result, stale-claim recovery after 10 min, max 3 attempts, then `failed` with a visible reason. Enqueue in the same transaction as the customer message (simulator, SES inbound, staff-created tickets).
- [ ] **4.2 Worker process (M).** `scripts/worker.mjs`: single instance (lock file), graceful SIGTERM, heartbeat row for `/api/ready`, serial drafting with timeouts. Runs under a new systemd unit (needs approval, decision 2).
- [ ] **4.3 Triage classifier (M).** Port the rule tables from `processor/classifier/tables/*.yaml` (regex rules, already JSON) into `lib/classifier/`. Escalate-only: can raise priority, force a sensitive draft or an owner alert, never lower. Runs before and after the model.
- [ ] **4.4 Priority-aware queue (S).** Within a window of 25 jobs, sensitive high/critical customer messages jump ahead.
- [ ] **4.5 Nothing-to-answer gate (S).** Pure thanks/acknowledgements skip drafting and alerts.
- [ ] **4.6 Drafter (L).** Server-side Workers AI call with read-only tools: `search_kb`, `get_order` (demo store, simulated orders only), `get_returns` (simulated), `get_ticket_history`. System prompt rewritten from the Hermes SOUL/skills (KB before answering, notices win, no promises of actions, sensitive-topic rules). Output must be a JSON result (draft, action, severity, missing_facts, staff_next_step) wrapped in markers with a per-run random token; customer-supplied markers neutralised; mismatch fails closed.
- [ ] **4.7 Draft cleaner (S).** Strip self-talk and internal notes, collapse repeats, sentence cap, flag unsupported action claims. Can only shorten or suppress.
- [ ] **4.8 Retries and supersession (M).** Transient failures retry at 30 s then 120 s (max 3); auth/invalid-output/safety failures go to staff. A newer customer message supersedes the older draft. A crash after a draft is saved keeps it.
- [ ] **4.9 Draft UI (M).** Suggestion strip in the conversation: Use draft, Dismiss, Restore, Expand, Copy; states queued / retrying / failed ("AI draft unavailable") with Retry; "Needs staff input" disables Use draft and shows the missing facts.
- [ ] **4.10 Rewrite with AI (S).** "Edit reply with AI": draft + instruction → new text only, single-slot concurrency, 150 s timeout, stale responses dropped.

### Phase 5 — Safe sending

- [ ] **5.1 Send intents for every reply (M).** Generalize `sim_email_outbox` into `send_intents` (operation id, content hash, recipient, source message, state) for both email and simulated replies. Ambiguous results never auto-retry.
- [ ] **5.2 Read & write switch (S).** Inbox starts read-only; a 30-minute, session-bound send grant (stored as a digest) enables sending; reload or expiry returns to read-only.
- [ ] **5.3 Review → Confirm & send (S).** Dialog shows recipient, the message being answered and the exact reply.
- [ ] **5.4 Stale-review rejection (S).** Refuse if a newer customer message, changed draft or changed recipient appeared since review.
- [ ] **5.5 Uncertain delivery (S).** Pending/unknown sends block a new reply until "Check status" resolves it.

### Phase 6 — Customer rail with store data

- [ ] **6.1 Customer rail (M).** Right-side rail: customer profile (export + demo store pseudonym), matched order, line items, tracking, refunds, order history; incomplete data shows "unavailable", never 0. Server-side, signed-in only, simulated orders only (existing rule).
- [ ] **6.2 Snapshot cache (S).** Cache store lookups per ticket in `sim.db` with a freshness timestamp ("showing last successful read" on failure).
- [ ] **6.3 Simulated returns (M).** `sim_returns` table; simulator creates a return/exchange record for Return/Exchange intents; rail shows returns only when the order matches the ticket's verified order (Redo-worker rule).

### Phase 7 — Learning loop

- [ ] **7.1 Lesson capture (S).** When staff send a reply that differs from or approves an AI draft, store a lesson packet (draft, final, ticket intent). Only delivered replies; never indexed directly.
- [ ] **7.2 PII masking (S).** Port `feedback/pii.py` rules to `lib/pii.ts` (emails, phones, order numbers, cards, addresses, known names) with tests.
- [ ] **7.3 Nightly promotion (S).** Worker job: approved lessons → masked exemplar docs in `kb/learned/` → reindex. Learning panel shows counts.

### Phase 8 — Alerts and notifications

- [ ] **8.1 Notifications bell (S).** Ticket-activity notifications per staff user, unread count, mark all read.
- [ ] **8.2 Owner alerts (M).** High/critical tickets (from 4.3) alert the owner by email (SES); de-duplicated; every attempt logged.
- [ ] **8.3 Alert log page (S).** Paged list of alert attempts, retry button, link to ticket.
- [ ] **8.4 Heartbeat alert (S).** If the worker heartbeat is stale, alert once and once more on recovery.
- [ ] **8.5 WhatsApp channel (L, optional).** Separate small Node service with Baileys QR pairing, test alert, unlink; bound to localhost behind Caddy. Only after decision 3.

### Phase 9 — Operations and console

- [ ] **9.1 Ops monitor (S).** Worker job every minute: service state, DB readiness, queue progress, disk headroom, backup age → `data/ops-status.json`.
- [ ] **9.2 Overview page (M).** Escalations, priority breakdown, recent staff activity, learning panel, system-health card (ok / stale / missing). Failed loads show "unavailable".
- [ ] **9.3 Encrypted backups (M).** Every 6 h: SQLite online backup of `sim.db` and `kb.db` + `kb/`, encrypted (openssl CMS, recipient cert), keep ≥3. Needs approval (systemd timer or worker job).
- [ ] **9.4 Restore check (S).** `npm run helpdesk -- restore-check <file>`: decrypt into a scratch folder, open, validate, never touch live data.
- [ ] **9.5 Runbook (S).** Extend `reference.md`: worker, backups, restore, alerts, login management.

### Phase 10 — Quality gates

- [ ] **10.1 Scenario harness (M).** Copy `testing/scenarios.json` (48) and `reliability-scenarios.json` (10); `npm run qa` runs the drafter offline against them (no sends, scratch DB) and writes a report for human A–E grading. Live-model runs are manual.
- [ ] **10.2 Adversarial tests (M).** Prompt injection in customer messages, forged markers, oversized/odd emails, queue crash recovery, auth bypass attempts on every route.
- [ ] **10.3 Browser tests (M).** Playwright: login, views/filters, bulk actions, draft strip, review-and-send, KB editor. Runs in CI.
- [ ] **10.4 Release gate (S).** `npm run verify` = lint + typecheck + unit + Playwright + scenario harness (offline) + secret scan; CI runs it.
- [ ] **10.5 Auto-deploy (M, optional).** On green `main`: restricted SSH command on the VPS that fetches the commit, verifies, builds, swaps and restarts, with rollback. Only after decision 5.

## Suggested first slice

Phase 0 → Phase 1 → 2.1–2.4. That gives a logged-in, properly triageable inbox before any new data or AI automation is added, and every later phase builds on it.
