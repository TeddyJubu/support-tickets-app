# AGENTS.md

Buttons Bebe helpdesk test system: a Next.js helpdesk live at https://helpdesk.teddyonfriday.com (staff sign-in required), a background worker that drafts AI replies, a customer simulator, and read-only order lookups in the Cute Things Shopify store.

**To operate it, follow the `helpdesk-control` skill:** [.claude/skills/helpdesk-control/SKILL.md](.claude/skills/helpdesk-control/SKILL.md) (architecture and troubleshooting in [reference.md](.claude/skills/helpdesk-control/reference.md)).

Quick start:

```bash
npm run helpdesk -- status              # health check (service, readiness, store, tickets)
npm run helpdesk -- worker              # AI drafting worker, queue, scheduled tasks
npm run helpdesk -- tickets             # inbox tickets
npm run helpdesk -- show SIM-1009       # read one
npm run simulate -- --count 3           # 3 simulated customers open tickets
npm run helpdesk -- restart             # after code changes: build + restart site (and worker)
npm test                                # unit, route and safety tests (scratch data, no network)
```

Hard rules:

- Never print secrets from `.env.local`.
- The Shopify store holds real customer data and is read-only here (`lib/shopify.ts` refuses mutations): never write to it. The one exception is an owner's Disconnect in Settings, which uninstalls the helpdesk's own app (`appUninstall`, `lib/shopify-connect.ts`). The store is connected from Settings (Shopify OAuth, owner only; keys encrypted in `data/`) unless `SHOPIFY_SHOP` pins it in `.env.local`. Store reads are limited to a verified email sender's own customer record and orders (`lib/store.ts`); simulated tickets have no store data. The old demo store (`shop-sim` Worker + D1) is no longer used: don't touch it.
- The site is on the public internet: pages and APIs are behind staff sign-in (`proxy.ts`). The exceptions: `/login`, `/api/auth/login`, `/api/health` and `/api/ready` are public (no data); the SES webhook checks its own token; `/api/shopify/webhooks` is public but checks Shopify's HMAC signature and returns no data; and the simulator/CLI key (`SIM_API_KEY`) opens only the simulator's own endpoints (`SIMULATOR` in `proxy.ts`: open a simulated ticket, post on one, list those waiting on the customer), which refuse every ticket the simulator didn't open and return no customer, store or draft data. Every other route calls `requireStaff` (or `requireOwner`) itself, and `tests/route-access.test.mjs` checks every `/api/helpdesk` route for staff, the key and nobody: classify new routes there. The CLI reads `data/` directly. Never add a public endpoint that returns store, customer or ticket data, and never widen what the key opens.
- Staff replies only go out through review and confirm (`lib/sending.ts`). Nothing sends to a customer automatically; the AI only drafts.
- `data/` (databases, KB articles, backups, keys) is never committed.
- Ask before resetting data or changing Caddy, systemd or Cloudflare settings.
