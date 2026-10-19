# Helpdesk system reference

## Architecture

```
browser ──https──▶ Caddy (helpdesk.teddyonfriday.com, Let's Encrypt)
                     └─▶ 127.0.0.1:3100  systemd service "support-tickets" (next start)
                           ├─ data/helpdesk.db   historical export (read-only, real PII)
                           ├─ data/sim.db        simulated tickets/messages/customers
                           ├─ Cloudflare Workers AI   chat model (OpenAI-compatible API)
                           └─ Cloudflare D1 "shop-sim" demo store (via D1 HTTP API)

scripts/simulate.mjs ──▶ D1 (places #S orders) ──▶ helpdesk /api/helpdesk/sim/* (opens tickets)
```

- **App**: Next.js 16 + `@yourgpt/copilot-sdk` / `@yourgpt/llm-sdk` 2.5.0. The chat route is `app/api/chat/route.ts`; the AI tools are in `app/components/ticketing-tools.tsx`.
- **Historical data**: Shopify customers/products and Gorgias tickets, loaded by `npm run seed` from `data/exports/*.csv` into `data/helpdesk.db` (`lib/helpdesk-db.ts`). Gorgias tickets have metadata only, no message bodies.
- **Simulated data**: `data/sim.db` (`lib/sim-db.ts`), written through the `/api/helpdesk/sim/*` routes. Customers are pseudonyms derived from a hash of the real email (the real email is never stored); they keep the real spend/order count and region.
- **Demo store**: Cloudflare Worker `shop-sim` (a Shopify Admin API simulator, private: its workers.dev route is off) on D1 database `shop-sim` (`433ed25d-4b4d-40db-beb0-ad2df6ce690c`). The helpdesk and simulator use the D1 HTTP API directly (`lib/store-d1.mjs`); the Worker is never called or modified. All store variant prices are `0.00`, so the simulator prices items from the product export by handle. Simulated orders use names `#S<n>` and numbers `9000000000000 + n`.
- **Workers**: all `node:sqlite` (Node 22+, experimental warning is expected).

## HTTP API (127.0.0.1:3100 or the public site)

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/helpdesk/tickets?source=sim\|history&q=&limit=&offset=` | none | list tickets |
| `GET /api/helpdesk/tickets/{id}` | none | ticket + customer + history (+ messages for SIM) |
| `GET /api/helpdesk/tickets/{id}/similar` | none | similar historical tickets |
| `GET /api/helpdesk/products?q=` · `/customers?q=` | none | search the export |
| `GET /api/helpdesk/orders?name=%23S1001` | none | simulated orders only |
| `POST /api/helpdesk/sim/tickets` | `Bearer SIM_API_KEY` | open a simulated ticket |
| `POST /api/helpdesk/sim/tickets/{id}/messages` | key for `author: customer`; none for `agent` | add a message |
| `PATCH /api/helpdesk/sim/tickets/{id}` `{status}` | none | open / pending / closed |
| `GET /api/helpdesk/sim/awaiting` | `Bearer SIM_API_KEY` | tickets waiting on the customer |
| `POST /api/helpdesk/email/tickets/{id}/reply` `{body, idempotencyKey}` | Caddy basic auth | email the customer via SES, then save the reply; a retry with the same key never emails twice (outbox: `sim_email_outbox`) |
| `POST /api/chat` | none | copilot runtime |

Ticket status: a customer message sets `open`, an agent reply sets `pending`, closing sets `closed`.

## Configuration (`.env.local`, never print values)

| Key | Used for |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Workers AI |
| `CF_MODEL` (optional) | chat + simulator model, default `@cf/zai-org/glm-5.3-flash` |
| `SIM_API_KEY` | simulator write access |
| `SIM_HELPDESK_URL` (optional) | helpdesk base URL for scripts, default `http://127.0.0.1:3100` |
| `SHOP_SIM_ACCOUNT_ID`, `SHOP_D1_DATABASE_ID`, `SHOP_D1_TOKEN` | demo store D1 access (token "helpdesk shop-sim deploy", has D1: Edit) |

The production server reads `.env.local` at startup: restart after changing it.

## Operations

- Rebuild + restart: `npm run helpdesk -- restart` (= `npm run build && sudo systemctl restart support-tickets`).
- Logs: `npm run helpdesk -- logs 200` or `sudo journalctl -u support-tickets -f`.
- Caddy config: `/etc/caddy/Caddyfile` (backups `Caddyfile.bak-*`). Caddy runs from a manual `caddy run`, not systemd; validate with `sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, apply with `sudo caddy reload … --adapter caddyfile`. Another site (`52.41.224.67.sslip.io` → :3002) shares it: don't touch that block.
- Search-engine blocking: `app/robots.ts`, robots meta in `app/layout.tsx`, `X-Robots-Tag` in `next.config.ts` and Caddy.
- Re-seed the export: put CSVs in `data/exports/` and `npm run seed` (rebuilds `data/helpdesk.db`; restart afterwards).
- Test email-reply idempotency (scratch copy of `data/sim.db`, SES stubbed, sends nothing): `node --no-warnings scripts/test-email-reply.mjs`.
- Inspect simulated store rows (read-only): `SELECT * FROM orders WHERE name LIKE '#S%'` on D1 `shop-sim`.

## Troubleshooting

| Symptom | Check |
|---|---|
| `status` says service inactive | `npm run helpdesk -- logs 100`, then `sudo systemctl restart support-tickets` |
| store "not configured" | `grep -c '^SHOP_D1_TOKEN=' .env.local`; restart after adding keys |
| simulator: `Store database: … not authorized` | the D1 token lost access; it needs Account → D1 → Edit on the account |
| simulator: `Workers AI` errors / slow | model quota or outage; try `--no-orders --count 1`, or set `CF_MODEL` |
| chat returns errors | `curl -s 127.0.0.1:3100/api/chat` shows provider + model; check Workers AI keys |
| UI doesn't show new SIM tickets | the Simulated tab polls every 10 s; confirm with `npm run helpdesk -- tickets` |
