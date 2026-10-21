---
name: helpdesk-control
description: Operate the Buttons Bebe helpdesk test system in this project — check status, list/read/reply to/close tickets, run the customer simulator (simulated customers who open tickets), manage staff accounts, check the AI drafting worker, the knowledge base, alerts and backups, check the read-only Shopify store connection, rebuild/restart the live site, and read logs. Use whenever the user asks to check, test, drive, simulate, reset, restart or troubleshoot the helpdesk, its tickets, AI drafts, KB, the simulator or the store connection (Shopify).
---

# Helpdesk control

The system: a Next.js support helpdesk live at https://helpdesk.teddyonfriday.com (staff sign-in), a background worker that drafts AI replies for review, a customer simulator, and read-only order lookups in the Cute Things Shopify store (`lib/shopify.ts`). Everything below runs from the project root, `/home/ubuntu/support-tickets-app`.

## Control CLI

Use `npm run helpdesk -- <command>` for everything day to day. Add `--json` to any command for machine-readable output.

| Goal | Command |
|---|---|
| Health check (service, site, Shopify connection, ticket counts, last backup) | `npm run helpdesk -- status` |
| List simulated tickets (default) | `npm run helpdesk -- tickets [--q TEXT] [--limit N]` |
| List historical (Gorgias export) tickets | `npm run helpdesk -- tickets --history [--q TEXT]` |
| Read a ticket with customer, conversation, history | `npm run helpdesk -- show SIM-1009` |
| Reply as the support agent | `npm run helpdesk -- reply SIM-1009 "text"` |
| Reply as the simulated customer | `npm run helpdesk -- customer SIM-1009 "text"` |
| Change status | `npm run helpdesk -- close|reopen|pending SIM-1009` |
| Similar historical tickets | `npm run helpdesk -- similar SIM-1009` |
| Search the catalog / customers (export) | `npm run helpdesk -- products tulle dress` · `customers cohen` |
| Rebuild and restart the live site (and worker) | `npm run helpdesk -- restart` |
| Service logs | `npm run helpdesk -- logs 100` |
| AI worker, draft queue, scheduled tasks | `npm run helpdesk -- worker` |
| Ops report (services, queue, disk, backups, KB) | `npm run helpdesk -- ops` |
| Staff accounts | `npm run helpdesk -- user list` · `user add <name> --name "Full Name" [--owner]` · `user password <name>` · `user disable <name>` |
| Encrypted backups (worker every 6 h, uploaded to the bucket) | `npm run helpdesk -- backups` · `backup` · `restore-check <file> --key <private key>` · `backup-download <file>` |
| Knowledge base | `npm run kb -- status` · `search <question>` · `index` · `products` |

## Customer simulator

Simulated customers replay real historical tickets under pseudonyms and email support; Workers AI writes the emails. They place no orders and their tickets have no store data (the store is the real Shopify store, which nothing here writes to).

```bash
npm run simulate -- --count 5                         # 5 new customers → tickets (~20 s each)
npm run simulate -- --follow-ups                      # customers answer tickets where the agent replied last
npm run simulate -- --loop --interval 120 --count 2   # keep going until stopped
npm run simulate -- --intent Return --count 3         # only replay one kind of request (Return, Damaged, Cancel, Status…)
npm run simulate -- --count 1 --dry-run               # show what would be sent, write nothing
npm run simulate -- --reset                           # delete simulated tickets and customers
```

A typical test cycle: `simulate --count N` → the worker drafts replies → handle tickets in the UI (Use draft, Review & send) or with `reply` → `simulate --follow-ups` → `show` to inspect → `close`. Run long loops in the background and stop them when done. Each simulated customer message costs one Workers AI draft; `AUTO_DRAFTS=0` in `.env.local` turns drafting off.

## Rules

- **Never print or log secrets** from `.env.local` (Cloudflare tokens, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_ADMIN_TOKEN`, `SIM_API_KEY`). Check that a key exists with `grep -c '^NAME=' .env.local`, never `cat` the file.
- **The Shopify store holds real customer data and is read-only here.** Never write to it (the client refuses mutations), and never export or display its customers or orders outside a ticket's own rail. The old demo store (`shop-sim` Worker + D1) is no longer used: don't touch it.
- **The helpdesk is on the public internet behind staff sign-in** (`proxy.ts`; search engines blocked). Never add a public endpoint that returns store, customer or ticket data. Store reads are limited to a verified email sender's own customer record and orders (`lib/store.ts`). Staff choose their own passwords: never set one for someone (`user add` / `user password` ask the person at the terminal).
- **Only people send.** The AI drafts; staff replies go out through Review and Confirm & send (`lib/sending.ts`). The CLI `reply` only works on simulated tickets, never on real email tickets.
- Historical tickets are read-only; `reply`/`close` only work on `SIM-…` tickets.
- After changing app code, run `npm run helpdesk -- restart` (it builds first). The user's own dev server may run on port 3000 — leave it alone.
- Ask the user before resetting simulated data, deleting anything, or changing Caddy, systemd or Cloudflare settings (including installing the worker/heartbeat units in `deploy/systemd/`).
- After changing app code, `npm test` and `npm run verify` before `restart`.

For architecture, data stores, configuration keys and troubleshooting, read [reference.md](reference.md).
