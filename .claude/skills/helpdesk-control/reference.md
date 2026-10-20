# Helpdesk system reference

## Architecture

```
browser ──https──▶ Caddy (helpdesk.teddyonfriday.com, Let's Encrypt; systemd "svvi-caddy")
                     └─▶ 127.0.0.1:3100  systemd service "support-tickets" (next start)
                           ├─ proxy.ts           sign-in required for every page and API route
                           ├─ data/helpdesk.db   historical export (read-only, real PII)
                           ├─ data/sim.db        simulated tickets/messages/customers
                           ├─ Cloudflare Workers AI   chat model (OpenAI-compatible API)
                           └─ Cloudflare D1 "shop-sim" demo store (via D1 HTTP API)

scripts/simulate.mjs ──▶ D1 (places #S orders) ──▶ helpdesk /api/helpdesk/sim/* (opens tickets)
scripts/backup-db.mjs ──▶ data/backups/*.db.gz ──▶ S3-compatible bucket (BACKUP_S3_URL), nightly timer
```

- **App**: Next.js 16 + `@yourgpt/copilot-sdk` / `@yourgpt/llm-sdk` 2.5.0. The chat route is `app/api/chat/route.ts`; the AI tools are in `app/components/ticketing-tools.tsx`.
- **Historical data**: Shopify customers/products and Gorgias tickets, loaded by `npm run seed` from `data/exports/*.csv` into `data/helpdesk.db` (`lib/helpdesk-db.ts`). Gorgias tickets have metadata only, no message bodies.
- **Simulated data**: `data/sim.db` (`lib/sim-db.ts`), written through the `/api/helpdesk/sim/*` routes. Customers are pseudonyms derived from a hash of the real email (the real email is never stored); they keep the real spend/order count and region.
- **Demo store**: Cloudflare Worker `shop-sim` (a Shopify Admin API simulator, private: its workers.dev route is off) on D1 database `shop-sim` (`433ed25d-4b4d-40db-beb0-ad2df6ce690c`). The helpdesk and simulator use the D1 HTTP API directly (`lib/store-d1.mjs`); the Worker is never called or modified. All store variant prices are `0.00`, so the simulator prices items from the product export by handle. Simulated orders use names `#S<n>` and numbers `9000000000000 + n`.
- **Workers**: all `node:sqlite` (Node 22+, experimental warning is expected).

## Sign-in

`proxy.ts` sends every request without a valid session to `/login` (pages) or answers 401 (API); the route handlers check again with `isAgentRequest` (`lib/auth.ts`). A session is an HttpOnly, SameSite=Lax cookie `hd_session` (Secure in production) signed with `SESSION_SECRET`, valid 12 hours, naming the agent.

Each agent has their own account (email + password) in the `agents` table of `data/sim.db` (`lib/agents.mjs`), managed with `npm run helpdesk -- agent add|list|disable|enable|password` (no restart needed). Every request re-checks the agent, so `disable` or `password` signs them out at once. Replies record the agent's name (`sim_messages.sender`) and id (`sim_messages.agent_id`); email to customers still comes from the store's sender name. Until the first agent exists, one shared password (`HELPDESK_PASSWORD_HASH`) signs in instead: `set-password` sets it and rotates `SESSION_SECRET` (signs everyone out; restart to apply). Creating the first agent switches the shared password off for good. `agent add` creates `SESSION_SECRET` if it's missing (restart to apply).

`Bearer SIM_API_KEY` counts as the operator, so the CLI and simulator work without a session. Sign-in allows 10 failed attempts per IP per 15 minutes.

## HTTP API (127.0.0.1:3100 or the public site)

"agent" = a signed-in session or `Bearer SIM_API_KEY`.

| Route | Auth | Purpose |
|---|---|---|
| `GET /login` · `POST /api/auth/login` · `POST /api/auth/logout` | none | sign in / out |
| `GET /api/helpdesk/tickets?source=sim\|history&q=&limit=&offset=` | agent | list tickets |
| `GET /api/helpdesk/tickets/{id}` | agent | ticket + customer + history (+ messages for SIM) |
| `GET /api/helpdesk/tickets/{id}/similar` | agent | similar historical tickets |
| `GET /api/helpdesk/products?q=` · `/customers?q=` | agent | search the export |
| `GET /api/helpdesk/orders?name=%23S1001` | agent | simulated orders only |
| `POST /api/helpdesk/sim/tickets` | `Bearer SIM_API_KEY` | open a simulated ticket |
| `POST /api/helpdesk/sim/tickets/{id}/messages` | key for `author: customer`; agent for `agent` | add a message |
| `PATCH /api/helpdesk/sim/tickets/{id}` `{status}` | agent | open / pending / closed |
| `GET /api/helpdesk/sim/awaiting` | `Bearer SIM_API_KEY` | tickets waiting on the customer |
| `POST /api/helpdesk/email/tickets/{id}/reply` `{body, idempotencyKey}` | agent + Caddy basic auth | email the customer via SES, then save the reply; a retry with the same key never emails twice (outbox: `sim_email_outbox`) |
| `POST /api/helpdesk/inbound/ses?token=` | `INBOUND_EMAIL_TOKEN` + SNS `TopicArn` | inbound email from SES via SNS |
| `POST /api/chat` · `GET /api/chat` | agent | copilot runtime · provider + model |

Ticket status: a customer message sets `open`, an agent reply sets `pending`, closing sets `closed`.

## Configuration (`.env.local`, never print values)

| Key | Used for |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Workers AI |
| `CF_MODEL` (optional) | chat + simulator model, default `@cf/zai-org/glm-5.3-flash` |
| `STORE_NAME`, `STORE_DESCRIPTION`, `SUPPORT_EMAIL`, `SENDER_NAME` | this install's store (`lib/settings.ts`): UI name, AI prompt, support address, email display name. Defaults are the demo install's (Cute Things); set them for every new store |
| `OUTBOUND_EMAIL_FROM` (optional) | full From header for replies, default `<SENDER_NAME> <SUPPORT_EMAIL>` |
| `SIM_API_KEY` | simulator write access; also the operator CLI's API access |
| `SESSION_SECRET` | signs session cookies; created by `agent add` or `set-password` |
| `HELPDESK_PASSWORD_HASH` | shared password, only until the first agent exists (`set-password`) |
| `SIM_HELPDESK_URL` (optional) | helpdesk base URL for scripts, default `http://127.0.0.1:3100` |
| `SHOP_SIM_ACCOUNT_ID`, `SHOP_D1_DATABASE_ID`, `SHOP_D1_TOKEN` | demo store D1 access (token "helpdesk shop-sim deploy", has D1: Edit) |
| `BACKUP_S3_URL`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` (optional) | off-box backups: bucket URL (R2: `https://<account>.r2.cloudflarestorage.com/<bucket>`) and its S3 API keys. Without them backups stay on this machine |
| `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX` (optional) | `auto` (R2, default) or the AWS region; object key prefix, default `helpdesk/` |

The production server reads `.env.local` at startup: restart after changing it.

## Operations

- Rebuild + restart: `npm run helpdesk -- restart` (= `npm run build && sudo systemctl restart support-tickets`).
- Logs: `npm run helpdesk -- logs 200` or `sudo journalctl -u support-tickets -f`.
- Caddy config: `/etc/caddy/Caddyfile` (backups `Caddyfile.bak-*`). Caddy runs under systemd as `svvi-caddy.service` (enabled, so it starts at boot; `Restart=on-failure`). The unit was set up for the SVVI viewer and serves this site from the same Caddyfile: don't disable or rename it. Validate with `sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, apply with `sudo systemctl reload svvi-caddy`. Another site (`52.41.224.67.sslip.io` → :3002) shares it: don't touch that block.
- Backups: `npm run backup` (nightly via `helpdesk-backup.timer`); see [Backups and restore](#backups-and-restore).
- Search-engine blocking: `app/robots.ts`, robots meta in `app/layout.tsx`, `X-Robots-Tag` in `next.config.ts` and Caddy.
- Re-seed the export: put CSVs in `data/exports/` and `npm run seed` (rebuilds `data/helpdesk.db`; restart afterwards).
- Test email-reply idempotency (scratch copy of `data/sim.db`, SES stubbed, sends nothing): `node --no-warnings scripts/test-email-reply.mjs`.
- Inspect simulated store rows (read-only): `SELECT * FROM orders WHERE name LIKE '#S%'` on D1 `shop-sim`.

## Backups and restore

`scripts/backup-db.mjs` (`npm run backup`) backs up `data/sim.db` (real inbound customer emails, agent replies, the email outbox) and `data/helpdesk.db` (the seeded export). Each DB is copied online with `VACUUM INTO`, which gives a consistent snapshot while the app writes. Never `cp` these files: they use WAL, so a plain copy can miss committed data or be corrupt. The copy is integrity-checked, gzipped to `data/backups/<db>-<UTC time>.db.gz` (mode 600) and uploaded to the bucket in `BACKUP_S3_URL` with signed checksums (until all three `BACKUP_S3_` keys are set, the upload is skipped, not failed). Local copies older than 14 days are deleted (`--keep-days N`), always keeping each DB's newest copy; the bucket expires old copies with its own lifecycle rule. `data/backups/last-run.json` records the last run, and `npm run helpdesk -- status` shows its age and whether the upload was done, skipped or failed. A failed DB or upload makes the run exit 1 (the timer shows as failed).

| Goal | Command |
|---|---|
| Back up now | `npm run backup` (`-- --no-upload` for local only) |
| Check a backup: gunzip, integrity check, row counts | `npm run backup -- verify data/backups/sim-<time>.db.gz` |
| Fetch a backup from the bucket (then verifies it) | `npm run backup -- download sim-<time>.db.gz` |
| Timer status / last runs | `systemctl list-timers helpdesk-backup.timer` · `journalctl -u helpdesk-backup -n 50` |

**Nightly timer.** `deploy/systemd/helpdesk-backup.service` + `.timer` (03:30 UTC, `Persistent=true` so a missed run happens at boot). Install once, with the user's OK: `sudo cp deploy/systemd/helpdesk-backup.* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now helpdesk-backup.timer`, then `sudo systemctl start helpdesk-backup` and check `journalctl -u helpdesk-backup`.

**Off-box copy.** Any S3-compatible bucket works. For Cloudflare R2: a private bucket with a lifecycle rule that deletes objects under `helpdesk/` after 30 days, and an R2 API token scoped to that bucket with Object Read & Write; put its keys in `.env.local` (`BACKUP_S3_*`). If this machine is lost, `.env.local` goes with it, so keep the bucket keys (and the other keys) in a password manager too.

**Restore** (ask the user first: it replaces live data). Shown for `sim.db`; `helpdesk.db` is the same, or rebuild it from the CSVs with `npm run seed`.

1. Pick a copy and check it: `ls -lt data/backups/` (if the machine is gone: `npm run backup -- download <file>`, or download it from the bucket dashboard), then `npm run backup -- verify data/backups/sim-<time>.db.gz`.
2. Stop the app: `sudo systemctl stop support-tickets`.
3. Move the live DB aside **with its WAL files**, so an old `-wal` is never applied to the restored copy: `mkdir -p data/pre-restore && mv data/sim.db data/sim.db-wal data/sim.db-shm data/pre-restore/` (a missing `-wal`/`-shm` is fine).
4. `gunzip -c data/backups/sim-<time>.db.gz > data/sim.db && chmod 600 data/sim.db`
5. `sudo systemctl start support-tickets`, then `npm run helpdesk -- status` and `npm run helpdesk -- tickets`.

Email that arrived after the backup isn't in the restored DB. SES also writes each inbound email to `INBOUND_EMAIL_BUCKET` (`inbound/…`), so look there for anything newer. Restore drill (no downtime): `npm run backup -- verify` on the newest copy.

## Troubleshooting

| Symptom | Check |
|---|---|
| `status` says service inactive | `npm run helpdesk -- logs 100`, then `sudo systemctl restart support-tickets` |
| store "not configured" | `grep -c '^SHOP_D1_TOKEN=' .env.local`; restart after adding keys |
| simulator: `Store database: … not authorized` | the D1 token lost access; it needs Account → D1 → Edit on the account |
| simulator: `Workers AI` errors / slow | model quota or outage; try `--no-orders --count 1`, or set `CF_MODEL` |
| chat returns errors | `GET /api/chat` (signed in, or with `Bearer SIM_API_KEY`) shows provider + model; check Workers AI keys |
| sign-in says "isn't set up" | `grep -c '^SESSION_SECRET=' .env.local` should be 1, and `npm run helpdesk -- agent list` should show an agent (or `HELPDESK_PASSWORD_HASH` be set); ask the user to run `agent add`, then restart |
| an agent can't sign in | `npm run helpdesk -- agent list`: check the email and that they aren't DISABLED; the user resets it with `agent password <email>` |
| sign-in says "Too many attempts" | 10 failures from one IP in 15 minutes; wait, or restart the service to clear it |
| everything returns 401 / redirects to `/login` | expected without a session; the CLI needs `SIM_API_KEY` in `.env.local` |
| UI doesn't show new SIM tickets | the Simulated tab polls every 10 s; confirm with `npm run helpdesk -- tickets` |
| `status` shows the backup as old, `upload FAILED` or `upload skipped` | `journalctl -u helpdesk-backup -n 50`; `grep -c '^BACKUP_S3_' .env.local` should be 3 or more; run `npm run backup` by hand to see the error |
| site down after a reboot | `systemctl status svvi-caddy support-tickets`; both are enabled and should start at boot |
