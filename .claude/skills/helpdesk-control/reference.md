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
                           ├─ Cloudflare D1 "shop-sim"  demo store (simulated customers/orders only)
                           └─ AWS SES/S3        inbound email, staff replies, owner alerts

systemd "support-tickets-worker" (scripts/worker.ts)
   draft queue → Workers AI drafter (read-only tools) → drafts for review
   every minute: owner alerts, ops monitor; 6 h: encrypted backups → data/backups/ → bucket (BACKUP_S3_URL); daily: product sync, learning, pruning
systemd timer "support-tickets-heartbeat" (scripts/heartbeat-check.ts): emails if the worker stops

scripts/simulate.mjs ──▶ D1 (#S orders) ──▶ /api/helpdesk/sim/* (bearer key: opens tickets)
```

- **App**: Next.js 16, TypeScript, `node:sqlite` (Node 22+). `lib/db.ts` opens each database once per process and applies `lib/sim-migrations.ts` on open.
- **Sign-in**: `lib/auth.ts` (PBKDF2 passwords, session tokens stored as SHA-256, 12 h idle / 7 day max, login rate limit). `proxy.ts` gates everything except `/login`, `/api/auth/login`, `/api/health`, `/api/ready` and the SES webhook. The simulator/CLI bearer key (`SIM_API_KEY`) only opens `/api/helpdesk/*`. Cookie-authenticated writes need a same-site `Origin`.
- **Inbox**: views, filters, bulk actions, notes, attachments (`data/attachments/`, content-addressed), snooze, read state: `lib/sim-db.ts`, `lib/triage.ts`.
- **AI drafts**: every customer message is triaged by the escalate-only classifier (`lib/classifier/`) and queued (`lib/drafting/queue.ts`) in the same transaction. The worker drafts with Workers AI and read-only tools (`lib/drafting/run.ts`, `tools.ts`), cleans the result (`cleaner.ts`) and saves it for review. A newer customer message supersedes waiting jobs and unused drafts.
- **Sending**: `lib/sending.ts`. Read & write grant (30 min, per session) → review (recipient, answered message, exact text) → confirm with an idempotency key. Unconfirmed sends block new replies until staff settle them.
- **Knowledge base**: `data/kb/{intents,faq,policies,tickets,learned,products}/*.md`, indexed into `data/kb.db` (FTS5 + bge-m3 embeddings, hybrid search). Notice Board notices override articles.
- **Learning**: delivered replies become lessons; owner approves; nightly promotion writes masked examples to `data/kb/learned/` (`lib/learning.ts`, `lib/pii.ts`).
- **Demo store**: Cloudflare Worker `shop-sim` (private) on D1 `shop-sim` (`433ed25d-4b4d-40db-beb0-ad2df6ce690c`), read and written through the D1 HTTP API (`lib/store-d1.mjs`); the Worker is never called. Simulated orders are `#S<n>` with numbers `9000000000000 + n`.

## HTTP API (all behind sign-in unless noted)

| Route | Purpose |
|---|---|
| `GET /api/health`, `GET /api/ready` | public: liveness; readiness (`ready`) and overall health (`healthy`, per check) |
| `POST /api/auth/login`, `/logout`, `GET /api/auth/me` | sign-in, sign-out, current user and staff list |
| `GET /api/helpdesk/tickets?source=sim&view=&priority=&assignee=&tag=&channel=&sort=&q=&offset=&limit=` | inbox list with per-view counts (`source` omitted: archive) |
| `POST /api/helpdesk/tickets` | staff open an email ticket for a customer |
| `GET /api/helpdesk/tickets/{id}` | ticket, customer, messages, attachments, AI draft state, pending send |
| `PATCH /api/helpdesk/sim/tickets/{id}`, `POST /api/helpdesk/sim/tickets/bulk` | triage one / many (status, priority, assigneeId, tags, snoozedUntil, read, trashed, spam, subject) |
| `POST /api/helpdesk/sim/tickets/{id}/messages` | internal notes (staff); simulated replies (CLI bearer only); customer messages (simulator) |
| `POST /api/helpdesk/send-access` `{enable}` | Read & write on/off |
| `POST /api/helpdesk/tickets/{id}/send/review` → `POST .../send` | review, then confirm `{body, reviewToken, idempotencyKey}` |
| `GET .../send`, `POST .../send/resolve` `{key, outcome}` | unconfirmed send status; settle it (`sent` / `not_sent`) |
| `GET/POST /api/helpdesk/sim/tickets/{id}/draft` | AI draft state; queue a new draft |
| `PATCH /api/helpdesk/drafts/{id}` `{state}`, `POST .../rewrite` | use / dismiss / restore a draft; "Edit with AI" |
| `GET /api/helpdesk/tickets/{id}/store` | customer rail: simulated store customer, orders, returns (cached, `?refresh=1`) |
| `GET /api/helpdesk/attachments/{id}` | an email attachment (images inline, others download) |
| `GET /api/kb/search?q=`, `/api/kb/articles`, `GET/PUT/POST /api/kb/article`, `POST /api/kb/reindex`, `GET /api/kb/status` | knowledge base (edits and re-index: owner) |
| `GET/POST /api/kb/notices`, `POST /api/kb/notices/{id}/end` | Notice Board (owner posts/ends) |
| `GET /api/learning`, `POST /api/learning/{id}` `{decision}` | lessons (masked); owner approves/rejects |
| `GET /api/alerts`, `POST /api/alerts/{id}/retry`, `POST /api/alerts/test` | owner alert log |
| `GET/POST /api/notifications` | the bell |
| `GET /api/overview` | Overview page data |
| `POST /api/helpdesk/sim/tickets` (bearer), `GET /api/helpdesk/sim/awaiting` (bearer) | simulator |
| `POST /api/helpdesk/inbound/ses?token=` | public, own token: SES → SNS inbound email |
| `POST /api/chat` | copilot runtime |

Ticket status: a customer message sets `open` (and wakes a snooze), an agent reply sets `pending`, closing sets `closed`. Priority only ever goes up automatically.

## Configuration (`.env.local`, never print values)

| Key | Used for |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Workers AI (copilot, drafter, embeddings) |
| `CF_MODEL` (optional) | chat/draft model, default `@cf/zai-org/glm-5.3-flash` |
| `SIM_API_KEY` | simulator and CLI bearer key |
| `SIM_HELPDESK_URL` (optional) | helpdesk base URL for scripts, default `http://127.0.0.1:3100` |
| `SHOP_SIM_ACCOUNT_ID`, `SHOP_D1_DATABASE_ID`, `SHOP_D1_TOKEN` | demo store D1 access (token "helpdesk shop-sim deploy", has D1: Edit) |
| `INBOUND_EMAIL_TOKEN`, `INBOUND_SNS_TOPIC_ARN`, `INBOUND_EMAIL_BUCKET` | inbound email webhook |
| `HELPDESK_AWS_ACCESS_KEY_ID`, `HELPDESK_AWS_SECRET_ACCESS_KEY`, `HELPDESK_AWS_REGION`, `OUTBOUND_EMAIL_FROM` | SES sending, S3 reads |
| `ALERT_EMAIL` (optional) | owner alert recipients, comma-separated; without it alerts stay in-app |
| `AUTO_DRAFTS` (optional) | `0` stops queuing AI drafts (triage still runs) |
| `HELPDESK_PUBLIC_URL` (optional) | links in alert emails, default `https://helpdesk.teddyonfriday.com` |
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
- **Tests**: `npm test` (scratch data, fake AI/SES/store, nothing sent); `npm run verify` runs the full release gate.
- **Simulated store rows**: `SELECT * FROM orders WHERE name LIKE '#S%'` on D1 `shop-sim` (read-only).
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
| "An earlier reply hasn't been confirmed" | the email service didn't confirm a send: check the support mailbox's Sent folder, then "It went out" / "It didn't go out" |
| Review refused: "customer wrote again" | read the new message, then review again |
| KB search returns nothing / "keyword only" | `npm run kb -- status`; re-index; Workers AI keys for embeddings |
| Customer rail: "isn't connected" / "simulated customers only" | `SHOP_D1_*` keys; real email customers never get store lookups |
| Alerts "Not emailed" | `ALERT_EMAIL` missing; set it, restart the worker, Retry on `/alerts` |
| Backups failing | `npm run helpdesk -- ops`; "No backup certificate" → `backup-setup` (the user then moves the private key off the server) |
| `status` says service inactive | `npm run helpdesk -- logs 100`, then `sudo systemctl restart support-tickets` |
| simulator: `Store database: … not authorized` | the D1 token lost access; it needs Account → D1 → Edit |
| simulator: `Workers AI` errors / slow | model quota or outage; try `--no-orders --count 1`, or set `CF_MODEL` |
| everything returns 401 / redirects to `/login` | expected without a session; the CLI needs `SIM_API_KEY` in `.env.local` |
| UI doesn't show new SIM tickets | the Simulated tab polls every 10 s; confirm with `npm run helpdesk -- tickets` |
| `offsiteBackups` failing: "local only" or "upload failed" | `grep -c '^BACKUP_S3_' .env.local` should be 3 or more (restart the worker after adding them); `npm run helpdesk -- backup` shows the upload error (a 403 means the token isn't scoped to this bucket with Object Read & Write) |
| site down after a reboot | `systemctl status svvi-caddy support-tickets`; both are enabled and should start at boot |
