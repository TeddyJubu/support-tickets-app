---
name: helpdesk-control
description: Operate the Buttons Bebe helpdesk test system in this project — check status, list/read/reply to/close tickets, run the customer simulator (simulated customers who order in the demo store and open tickets), look up simulated store orders, search products/customers, rebuild/restart the live site, and read logs. Use whenever the user asks to check, test, drive, simulate, reset, restart or troubleshoot the helpdesk, its tickets, the simulator or the demo store (shop-sim).
---

# Helpdesk control

The system: a Next.js support helpdesk live at https://helpdesk.teddyonfriday.com, plus a customer simulator and a private demo store (Cloudflare Worker `shop-sim` with its D1 database). Everything below runs from the project root, `/home/ubuntu/support-tickets-app`.

## Control CLI

Use `npm run helpdesk -- <command>` for everything day to day. Add `--json` to any command for machine-readable output.

| Goal | Command |
|---|---|
| Health check (service, site, store, ticket counts, last backup) | `npm run helpdesk -- status` |
| List simulated tickets (default) | `npm run helpdesk -- tickets [--q TEXT] [--limit N]` |
| List historical (Gorgias export) tickets | `npm run helpdesk -- tickets --history [--q TEXT]` |
| Read a ticket with customer, conversation, history | `npm run helpdesk -- show SIM-1009` |
| Reply as the support agent | `npm run helpdesk -- reply SIM-1009 "text"` |
| Reply as the simulated customer | `npm run helpdesk -- customer SIM-1009 "text"` |
| Change status | `npm run helpdesk -- close|reopen|pending SIM-1009` |
| Similar historical tickets | `npm run helpdesk -- similar SIM-1009` |
| A simulated order in the store | `npm run helpdesk -- order S1002` |
| Search the catalog / customers (export) | `npm run helpdesk -- products tulle dress` · `customers cohen` |
| Rebuild and restart the live site | `npm run helpdesk -- restart` |
| Service logs | `npm run helpdesk -- logs 100` |
| Give someone a sign-in (prompts for their password; ask the user to type it) | `npm run helpdesk -- agent add <email> <name> [--admin]` |
| List / disable / enable agents, reset a password | `npm run helpdesk -- agent list` · `agent disable <email>` · `agent enable <email>` · `agent password <email>` |
| Shared sign-in password (only before the first agent exists) | `npm run helpdesk -- set-password`, then `restart` |
| Back up the databases now / check a backup | `npm run backup` · `npm run backup -- verify data/backups/sim-<time>.db.gz` |

## Customer simulator

Simulated customers replay real historical tickets under pseudonyms. With the store connected, each one places an order (`#S1001`, `#S1002`, …) and then emails support about it; Workers AI writes the emails.

```bash
npm run simulate -- --count 5                         # 5 new customers → orders → tickets (~20 s each)
npm run simulate -- --follow-ups                      # customers answer tickets where the agent replied last
npm run simulate -- --loop --interval 120 --count 2   # keep going until stopped
npm run simulate -- --intent Return --count 3         # only replay one kind of request (Return, Damaged, Cancel, Status…)
npm run simulate -- --count 1 --dry-run               # show what would be sent, write nothing
npm run simulate -- --no-orders                       # tickets without store orders
npm run simulate -- --reset                           # delete simulated tickets (store orders stay)
```

A typical test cycle: `simulate --count N` → handle tickets (UI or `reply`) → `simulate --follow-ups` → `show` to inspect → `close`. Run long loops in the background and stop them when done.

## Rules

- **Never print or log secrets** from `.env.local` (Cloudflare tokens, `SHOP_D1_TOKEN`, `SIM_API_KEY`, `HELPDESK_PASSWORD_HASH`, `SESSION_SECRET`). Check that a key exists with `grep -c '^NAME=' .env.local`, never `cat` the file.
- **The demo store holds real customer data** (≈46k real customers, 324k real orders). Only ever write simulated rows (tagged `simulated`, `#S…` orders, `@customers.bb-sim.test` emails). Never modify, export or display real customers/orders, and don't change the `shop-sim` Worker itself.
- **The helpdesk is on the public internet behind a sign-in.** Every page and API route needs a signed-in agent or `Bearer SIM_API_KEY` (the CLI sends it); keep new routes behind `proxy.ts` and check `isAgentRequest` in the handler. Don't add endpoints that expose store or customer data; the order lookup only serves orders referenced by simulated tickets. The user signs in with a password only they know: never set it for them.
- Historical tickets are read-only; `reply`/`close` only work on `SIM-…` tickets.
- After changing app code, run `npm run helpdesk -- restart` (it builds first). The user's own dev server may run on port 3000 — leave it alone.
- Ask the user before resetting simulated data, deleting anything, or changing Caddy, systemd or Cloudflare settings.

For architecture, data stores, configuration keys and troubleshooting, read [reference.md](reference.md).
