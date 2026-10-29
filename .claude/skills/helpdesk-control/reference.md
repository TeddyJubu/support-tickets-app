# Helpdesk system reference

## Architecture

```
browser ──https──▶ Caddy (helpdesk.teddyonfriday.com, Let's Encrypt; systemd "svvi-caddy")
                     └─▶ 127.0.0.1:3100  systemd "support-tickets" (next start)
                           proxy.ts: staff sign-in on every page and API
                           ├─ data/sim.db       inbox: tickets, staff, drafts, jobs, sends, lessons, alerts…
                           ├─ data/helpdesk.db  historical export (read-only, real PII)
                           ├─ data/kb/ + kb.db  knowledge base articles and search index
                           ├─ Cloudflare Workers AI  copilot chat, KB embeddings
                           ├─ Shopify Admin API  the connected store, read-only (verified senders' own orders)
                           └─ AWS SES/S3        inbound email, staff replies, owner alerts

systemd "support-tickets-worker" (scripts/worker.ts)
   draft queue → Workers AI drafter (read-only tools) → drafts for review
   every minute: owner alerts, ops monitor; 6 h: encrypted backups → data/backups/ → bucket (BACKUP_S3_URL); daily: product sync, learning, pruning
systemd timer "support-tickets-heartbeat" (scripts/heartbeat-check.ts): emails if the worker stops

scripts/simulate.mjs ──▶ /api/helpdesk/sim/tickets, …/messages, /awaiting (bearer key: simulated tickets only)
scripts/helpdesk.mjs ──▶ data/ directly (reply/customer: the simulator's messages endpoint, bearer key)
```

- **App**: Next.js 16, TypeScript, `node:sqlite` (Node 22+). `lib/db.ts` opens each database once per process and applies `lib/sim-migrations.ts` on open.
- **Sign-in**: `lib/auth.ts` (PBKDF2 passwords, session tokens stored as SHA-256, 12 h idle / 7 day max, login rate limit). `proxy.ts` gates everything except `/login`, `/api/auth/login`, `/api/health`, `/api/ready` and the SES webhook. The simulator/CLI bearer key (`SIM_API_KEY`) opens only the simulator's endpoints (`SIMULATOR` in `proxy.ts`), and those refuse any ticket the simulator didn't open (`isSimulatedTicket`: channel `simulator`, pseudonymous customer) and answer with `simulatorView` (the ticket and its customer/agent messages: no notes, drafts, customer record or history). Every other `/api/helpdesk` route is staff-only (`requireStaff`); `tests/route-access.test.mjs` checks each one for a staff session, the key and nobody. Cookie-authenticated writes need a same-site `Origin`.
- **Inbox**: views, filters, bulk actions, notes, attachments (`data/attachments/`, content-addressed), snooze, read state: `lib/sim-db.ts`, `lib/triage.ts`.
- **AI drafts**: every customer message is triaged by the escalate-only classifier (`lib/classifier/`) and queued (`lib/drafting/queue.ts`) in the same transaction. The worker drafts with Workers AI and read-only tools (`lib/drafting/run.ts`, `tools.ts`), cleans the result (`cleaner.ts`) and saves it for review. A newer customer message supersedes waiting jobs and unused drafts; a staff reply skips waiting jobs, and a job already running doesn't save its draft.
- **Sending**: `lib/sending.ts`. Read & write grant (30 min, per session) → review (recipient, subject, answered message, exact text) → confirm with an idempotency key. A newer customer message, a reply anyone sent since, or a changed text, recipient or subject cancels the review. Unconfirmed sends block new replies until staff settle them; one the email service accepted (it has a Message-ID) can only be recorded as sent.
- **Knowledge base**: `data/kb/{intents,faq,policies,tickets,learned,products}/*.md`, indexed into `data/kb.db` (FTS5 + bge-m3 embeddings, hybrid search). Notice Board notices override articles.
- **Learning**: delivered replies become lessons; owner approves; nightly promotion writes masked examples to `data/kb/learned/` (`lib/learning.ts`, `lib/pii.ts`).
- **Store**: the connected Shopify store through the Admin GraphQL API (`lib/shopify.ts`): queries only (mutations are refused before sending), retries on throttling. Which store: `SHOPIFY_SHOP` in `.env.local` pins one (client-credentials token renewed before it expires, or a fixed `SHOPIFY_ADMIN_TOKEN`); otherwise an owner connects one in Settings (`lib/shopify-connect.ts`): Shopify OAuth with a signed state cookie and HMAC-checked callback, expiring offline tokens saved AES-GCM-encrypted in `shopify_connection` (key `data/shopify-token.key`, not in backups) and refreshed by one process at a time (`lib/shopify-tokens.ts`). A refused refresh marks the store "reconnect", turns lookups off and alerts the owners once. Disconnect calls `appUninstall` (the only write to Shopify) and deletes the keys and cached store data. Shopify's webhooks (`app/uninstalled`, the three privacy topics) are HMAC-checked and deduped in `shopify_webhooks`; a privacy data request raises an owner alert with ticket IDs (answer it within 30 days), a customer redact clears that customer's cached store data. `lib/store.ts` decides access: only an email ticket whose sender passed DMARC (`sim_tickets.sender_verified = 1`; one failing message clears it for good) and whose address matches the customer key, and only that Shopify customer's own orders (exact email match). Simulated tickets, legacy email tickets (before verification was recorded) and unverified senders get no store data. Reads are cached per ticket for 5 minutes in `store_snapshots`, with the last good read shown as stale when Shopify fails; the drafter and copilot get an error instead of a stale order. The AI's `get_order` gets the order only: no address, email or IDs. The old demo store (`shop-sim` Worker + D1) is no longer used.

## HTTP API (all behind sign-in unless noted)

| Route | Purpose |
|---|---|
| `GET /api/health`, `GET /api/ready` | public: liveness; readiness (`ready`) and overall health (`healthy`, per check) |
| `POST /api/auth/login`, `/logout`, `GET /api/auth/me` | sign-in, sign-out, current user and staff list |
| `GET /api/helpdesk/tickets?source=sim&view=&priority=&assignee=&tag=&channel=&sort=&q=&offset=&limit=` | inbox list with per-view counts (`source` omitted: archive) |
| `POST /api/helpdesk/tickets` | staff open an email ticket for a customer |
| `GET /api/helpdesk/tickets/{id}` | ticket, customer, messages, attachments, AI draft state, pending send |
| `PATCH /api/helpdesk/sim/tickets/{id}`, `POST /api/helpdesk/sim/tickets/bulk` | triage one / many (status, priority, assigneeId, tags, snoozedUntil, read, trashed, spam, subject) |
| `POST /api/helpdesk/sim/tickets/{id}/messages` | internal notes (staff); simulated replies and customer messages (bearer key, simulated tickets only) |
| `POST /api/helpdesk/send-access` `{enable}` | Read & write on/off |
| `POST /api/helpdesk/tickets/{id}/send/review` → `POST .../send` | review, then confirm `{body, reviewToken, idempotencyKey}` |
| `GET .../send`, `POST .../send/resolve` `{key, outcome}` | unconfirmed send status; settle it (`sent` / `not_sent`) |
| `GET/POST /api/helpdesk/sim/tickets/{id}/draft` | AI draft state; queue a new draft |
| `PATCH /api/helpdesk/drafts/{id}` `{state}`, `POST .../rewrite` | use / dismiss / restore a draft; "Edit with AI" |
| `GET /api/helpdesk/tickets/{id}/store` | customer rail: the verified sender's Shopify customer, orders, returns (cached, `?refresh=1`) |
| `GET /api/shopify/status` (staff), `POST /api/shopify/connect` `{shop}` → Shopify → `GET /api/shopify/callback`, `POST /api/shopify/disconnect` (owner) | Settings: the store connection |
| `POST /api/shopify/webhooks` | public, Shopify's HMAC: app uninstalled and privacy webhooks, answers `{ok:true}` only |
| `GET /api/helpdesk/attachments/{id}` | an email attachment (images inline, others download) |
| `GET /api/kb/search?q=`, `/api/kb/articles`, `GET/PUT/POST /api/kb/article`, `POST /api/kb/reindex`, `GET /api/kb/status` | knowledge base (edits and re-index: owner) |
| `GET/POST /api/kb/notices`, `POST /api/kb/notices/{id}/end` | Notice Board (owner posts/ends) |
| `GET /api/learning`, `POST /api/learning/{id}` `{decision}` | lessons (masked); owner approves/rejects |
| `GET /api/alerts`, `POST /api/alerts/{id}/retry`, `POST /api/alerts/test` | owner alert log |
| `GET/POST /api/notifications` | the bell |
| `GET /api/overview` | Overview page data |
| `POST /api/helpdesk/sim/tickets` (bearer), `GET /api/helpdesk/sim/awaiting` (bearer) | simulator: open a simulated ticket; simulated tickets waiting on the customer (both answer with `simulatorView`) |
| `POST /api/helpdesk/inbound/ses?token=` | public, own token: SES → SNS inbound email |
| `POST /api/chat` | copilot runtime |

Ticket status: a customer message sets `open` (and wakes a snooze), an agent reply sets `pending`, closing sets `closed`. Priority only ever goes up automatically.

## Configuration (`.env.local`, never print values)

| Key | Used for |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Workers AI (copilot, drafter, embeddings) |
| `CF_MODEL` (optional) | chat/draft model, default `@cf/zai-org/glm-5.3-flash` |
| `STORE_NAME`, `STORE_DESCRIPTION`, `SUPPORT_EMAIL`, `SENDER_NAME` | this install's store (`lib/settings.ts`): the name in the UI, the copilot/draft/rewrite prompts and alert emails, the support address, and the sign-off and email display name. Defaults are the demo install's (Cute Things); set them for every new store. The copilot's instructions are built on the server (`app/api/chat/route.ts`); the browser only sends the open ticket's context |
| `SIM_API_KEY` | simulator bearer key (also the CLI's `reply` and `customer`): opens the simulator's endpoints only, for simulated tickets only |
| `SIM_HELPDESK_URL` (optional) | helpdesk base URL for scripts, default `http://127.0.0.1:3100` |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | the Dev Dashboard app's credentials (scopes `read_customers`, `read_orders`; protected customer data: name and email; redirect, App and webhook URLs as Settings shows them). With these an owner connects a store in Settings |
| `SHOPIFY_SCOPES` (optional) | extra read scopes, e.g. `read_all_orders` for orders older than 60 days |
| `SHOPIFY_SHOP` (optional) | pin a store (`cute-things` or `cute-things.myshopify.com`) instead of Settings; the app must be installed on it |
| `SHOPIFY_ADMIN_TOKEN` (optional) | a fixed Admin API token (`shpat_…`) instead of the client credentials |
| `SHOPIFY_API_VERSION` (optional) | Admin API version, default `2026-10` |
| `INBOUND_EMAIL_TOKEN`, `INBOUND_SNS_TOPIC_ARN`, `INBOUND_EMAIL_BUCKET` | inbound email webhook |
| `HELPDESK_AWS_ACCESS_KEY_ID`, `HELPDESK_AWS_SECRET_ACCESS_KEY`, `HELPDESK_AWS_REGION`, `OUTBOUND_EMAIL_FROM` | SES sending, S3 reads |
| `ALERT_EMAIL` (optional) | owner alert recipients, comma-separated; without it alerts stay in-app |
| `AUTO_DRAFTS` (optional) | `0` stops queuing AI drafts (triage still runs) |
| `HELPDESK_PUBLIC_URL` (optional) | links in alert emails, the site `helpdesk status` checks and the Shopify redirect/webhook URLs, default `https://helpdesk.teddyonfriday.com` |
| `BACKUP_RECIPIENT_CERT` (optional) | backup certificate, default `data/backup-keys/recipient.pem` |
| `HELPDESK_DATA_DIR`, `HELPDESK_KB_DIR` (optional) | data folders (tests use scratch folders) |
| `BACKUP_S3_URL`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | off-site copies of the encrypted backups: bucket URL (R2: `https://<account>.r2.cloudflarestorage.com/<bucket>`) and a token for that bucket only. Without them backups stay on this machine and `ops` shows `offsiteBackups` failing |
| `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX` (optional) | `auto` (R2, default) or the AWS region; object key prefix, default `helpdesk/` |

The server and worker read `.env.local` at startup: restart both after changing it.

## Operations

- **Rebuild + restart**: `npm run helpdesk -- restart` (build, restart `support-tickets`, and the worker when installed).
- **Staff accounts**: `npm run helpdesk -- user list | add <name> --name "Full Name" [--owner] | password <name> | disable <name>`. Passwords are typed at a hidden prompt. A new password or disabling signs the user out everywhere.
- **Worker**: `npm run helpdesk -- worker` (heartbeat, queue, last run of each task). Logs: `sudo journalctl -u support-tickets-worker -f`. Run by hand: `npm run worker`.
- **Knowledge base**: `npm run kb -- import <dir> | index | products | search <q> | status`. Edits from the `/kb` page need "Re-index" (or the nightly product sync) to reach the AI.
- **Ops monitor**: `npm run helpdesk -- ops`; the worker writes `data/ops-status.json` every minute (shown on `/overview`).
- **Backups**: encrypted, every 6 h by the worker, uploaded to the bucket; see [Backups and restore](#backups-and-restore).
- **Alerts**: set `ALERT_EMAIL`, send a test from `/alerts`. The heartbeat timer emails when the worker stops and when it recovers.
- **Tests**: `npm test` (scratch data, fake AI/SES/Shopify, nothing sent); `npm run verify` runs the full release gate. The unit tests, the QA harness and the browser-test server keep only an allow-list of environment variables (`scripts/test-env.ts`), and the browser-test server can't load `.env.local`, so no live key reaches a test (`tests/test-env.test.mjs` checks every key in the table above). `npm run qa -- --live` adds only the Workers AI keys and the store's name.
- **Shopify connection**: Settings (`/settings`, owner connects/disconnects); `npm run helpdesk -- status` reads the shop's name (no customer or order data).
- **Logs**: `npm run helpdesk -- logs 200` or `sudo journalctl -u support-tickets -f`.
- Caddy config: `/etc/caddy/Caddyfile` (backups `Caddyfile.bak-*`). Caddy runs under systemd as `svvi-caddy.service` (enabled, so it starts at boot; `Restart=on-failure`). The unit was set up for the SVVI viewer and serves this site from the same Caddyfile: don't disable or rename it. Validate with `sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, apply with `sudo systemctl reload svvi-caddy`. Another site (`52.41.224.67.sslip.io` → :3002) shares it: don't touch that block.
- Search-engine blocking: `app/robots.ts`, robots meta in `app/layout.tsx`, `X-Robots-Tag` in `next.config.ts` and Caddy.
- Re-seed the export: put CSVs in `data/exports/` and `npm run seed` (rebuilds `data/helpdesk.db`; restart afterwards).

## Backups and restore

`lib/ops/backup.ts`. Every 6 hours the worker (and `npm run helpdesk -- backup` on demand) takes online SQLite backups of `data/sim.db` (tickets, real customer emails, staff, drafts, lessons) and `data/kb.db`, copies the `data/kb/` articles, writes a manifest with checksums, and encrypts the tar.gz with OpenSSL CMS (AES-256-GCM) to the certificate in `data/backup-keys/recipient.pem`. The server holds only that public half: **the private key lives off the server** (password manager or laptop), so neither the server's backups nor the bucket can be read without it. Files: `data/backups/helpdesk-<time>.tar.gz.cms` (mode 600); the newest 8 are kept. `data/helpdesk.db` (the CSV export) is not backed up: `npm run seed` rebuilds it.

After each backup, every local backup the bucket doesn't have yet is uploaded (newest first, with signed checksums), so a failed upload is retried on the next run. Only these encrypted files ever leave the server. Until the three `BACKUP_S3_` keys are set, nothing is uploaded and `ops` shows `offsiteBackups` failing ("local only"); a failed upload doesn't fail the backup itself, `ops` and `status` report it.

| Goal | Command |
|---|---|
| One-time setup: create the key pair | `npm run helpdesk -- backup-setup`, then the user copies the private key off the server and runs the `shred -u` it prints |
| Back up (and upload) now | `npm run helpdesk -- backup` |
| List backups; is the newest in the bucket? | `npm run helpdesk -- backups` (also `status`, `ops`) |
| Check a backup (decrypts into a temp folder; integrity, checksums, row counts; never touches live data) | `npm run helpdesk -- restore-check <file> --key <private key>` |
| Fetch a backup from the bucket (e.g. on a new server) | `npm run helpdesk -- backup-download helpdesk-<time>.tar.gz.cms` |

**Bucket.** Any S3-compatible bucket works. For Cloudflare R2: the private bucket `helpdesk-backups` with a lifecycle rule that deletes objects under `helpdesk/` after 30 days, and an R2 API token scoped to that bucket with Object Read & Write; the user puts its keys in `.env.local` (`BACKUP_S3_*`), then restart (the worker reads them at start). If this machine is lost, `.env.local` goes with it, so keep the bucket keys (and the other keys) in a password manager too, next to the backup private key.

**Restore** (ask the user first: it replaces live data; the user supplies the private key).

1. Pick a backup and check it: `npm run helpdesk -- backups` (if the machine is gone: `backup-download <file>`), then `restore-check <file> --key <private key>`.
2. Decrypt and unpack into a private temp folder: `mkdir -m 700 /tmp/restore && openssl cms -decrypt -binary -inform DER -in data/backups/<file> -inkey <private key> -out /tmp/restore/b.tar.gz && tar -xzf /tmp/restore/b.tar.gz -C /tmp/restore`.
3. Stop the app and the worker: `sudo systemctl stop support-tickets support-tickets-worker`.
4. Move the live databases aside **with their WAL files**, so an old `-wal` is never applied to the restored copy: `mkdir -p data/pre-restore && mv data/sim.db* data/kb.db* data/pre-restore/` and `mv data/kb data/pre-restore/kb`.
5. `cp /tmp/restore/sim.db /tmp/restore/kb.db data/ && cp -r /tmp/restore/kb data/kb && chmod 600 data/sim.db data/kb.db`, then `rm -rf /tmp/restore`.
6. `sudo systemctl start support-tickets support-tickets-worker`, then `npm run helpdesk -- status` and `npm run helpdesk -- tickets`.

Email that arrived after the backup isn't in the restored database. SES also writes each inbound email to `INBOUND_EMAIL_BUCKET` (`inbound/…`), so look there for anything newer. Restore drill (no downtime): `restore-check` on the newest backup.

## Troubleshooting

| Symptom | Check |
|---|---|
| Sign-in page says no accounts exist | `npm run helpdesk -- user add <name> --owner` on the server |
| "Too many attempts" at sign-in | 6 failures per username / 20 per IP in 15 min; wait, or reset a password |
| AI drafts never appear | `npm run helpdesk -- worker`: not running → `sudo systemctl status support-tickets-worker`; jobs failed → the error is on the draft strip |
| Drafts "delayed, retrying" | Workers AI timeouts or 429s; retries at 30 s and 120 s, then "unavailable" with Retry |
| "Read-only" / can't send | turn on Read & write (30 min, per page load) |
| "An earlier reply hasn't been confirmed" | the email service didn't confirm a send: check the support mailbox's Sent folder, then "It went out" / "It didn't go out" (only "It went out" when the email service accepted it but it wasn't saved) |
| Review refused: "customer wrote again" | read the new message, then review again |
| Review refused: "Someone replied on this ticket" | a colleague (or another tab) answered first: read their reply before sending another |
| KB search returns nothing / "keyword only" | `npm run kb -- status`; re-index; Workers AI keys for embeddings |
| Customer rail: "needs reconnecting" | Shopify refused the saved keys (app uninstalled, or keys revoked): an owner clicks Reconnect in Settings |
| Settings: "Connecting the store didn't work" | the reason is shown; usually the app's redirect URL doesn't match Settings' "Allowed redirection URL" (check `HELPDESK_PUBLIC_URL`), a scope wasn't granted, or the attempt took over 10 minutes |
| Customer rail: "isn't connected" | connect a store in Settings, or (pinned) `grep -c '^SHOPIFY_' .env.local`; restart after adding them; `npm run helpdesk -- status` shows the sign-in error (`shop_not_permitted`: the app isn't installed on the store or is in another organization) |
| Customer rail: "couldn't be verified" / "before senders were verified" / "doesn't match their record" | expected: store data needs a DMARC-passing sender whose address matches the ticket; staff can open a new ticket for the customer (`POST /api/helpdesk/tickets`), which counts as verified |
| Customer rail: "No customer in the Shopify store has this email address" | the sender's address isn't on a Shopify customer exactly (Shopify matches the customer's email, not order emails) |
| Customer rail: "couldn't be reached: … Access denied" | the app lacks a scope or protected customer data access: `status` lists missing scopes; update the app in the Dev Dashboard and reinstall it |
| Alerts "Not emailed" | `ALERT_EMAIL` missing; set it, restart the worker, Retry on `/alerts` |
| Backups failing | `npm run helpdesk -- ops`; "No backup certificate" → `backup-setup` (the user then moves the private key off the server) |
| `status` says service inactive | `npm run helpdesk -- logs 100`, then `sudo systemctl restart support-tickets` |
| simulator: `Workers AI` errors / slow | model quota or outage; try `--count 1`, or set `CF_MODEL` |
| everything returns 401 / redirects to `/login` | expected without a session. The key gets 401 everywhere but the simulator's endpoints; the CLI reads `data/` directly, and only `reply`/`customer` and the simulator need `SIM_API_KEY` in `.env.local` |
| UI doesn't show new SIM tickets | the Simulated tab polls every 10 s; confirm with `npm run helpdesk -- tickets` |
| `offsiteBackups` failing: "local only" or "upload failed" | `grep -c '^BACKUP_S3_' .env.local` should be 3 or more (restart the worker after adding them); `npm run helpdesk -- backup` shows the upload error (a 403 means the token isn't scoped to this bucket with Object Read & Write) |
| site down after a reboot | `systemctl status svvi-caddy support-tickets`; both are enabled and should start at boot |
