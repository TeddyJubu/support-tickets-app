# AGENTS.md

Buttons Bebe helpdesk test system: a Next.js helpdesk live at https://helpdesk.teddyonfriday.com (staff sign-in required), a background worker that drafts AI replies, a customer simulator, and a private demo store (Cloudflare `shop-sim` + D1).

**To operate it, follow the `helpdesk-control` skill:** [.claude/skills/helpdesk-control/SKILL.md](.claude/skills/helpdesk-control/SKILL.md) (architecture and troubleshooting in [reference.md](.claude/skills/helpdesk-control/reference.md)).

Quick start:

```bash
npm run helpdesk -- status              # health check (service, readiness, store, tickets)
npm run helpdesk -- worker              # AI drafting worker, queue, scheduled tasks
npm run helpdesk -- tickets             # inbox tickets
npm run helpdesk -- show SIM-1009       # read one
npm run simulate -- --count 3           # 3 simulated customers order and open tickets
npm run helpdesk -- restart             # after code changes: build + restart site (and worker)
npm test                                # unit, route and safety tests (scratch data, no network)
```

Hard rules:

- Never print secrets from `.env.local`.
- The demo store holds real customer data: only write simulated rows (`#S…` orders, `@customers.bb-sim.test` emails), never touch real ones or the `shop-sim` Worker. Store reads are limited to simulated customers and `#S` orders.
- The site is on the public internet: pages and APIs are behind staff sign-in (`proxy.ts`). The exceptions: `/login`, `/api/auth/login`, `/api/health` and `/api/ready` are public (no data); the SES webhook checks its own token; and `/api/helpdesk/*` also accepts the simulator/CLI key (`SIM_API_KEY`), so routes there that return customer, store or draft data must call `requireStaff` themselves. Never add a public endpoint that returns store, customer or ticket data.
- Staff replies only go out through review and confirm (`lib/sending.ts`). Nothing sends to a customer automatically; the AI only drafts.
- `data/` (databases, KB articles, backups, keys) is never committed.
- Ask before resetting data or changing Caddy, systemd or Cloudflare settings.
