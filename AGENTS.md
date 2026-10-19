# AGENTS.md

Buttons Bebe helpdesk test system: a Next.js helpdesk live at https://helpdesk.teddyonfriday.com, a customer simulator, and a private demo store (Cloudflare `shop-sim` + D1).

**To operate it, follow the `helpdesk-control` skill:** [.claude/skills/helpdesk-control/SKILL.md](.claude/skills/helpdesk-control/SKILL.md) (architecture and troubleshooting in [reference.md](.claude/skills/helpdesk-control/reference.md)).

Quick start:

```bash
npm run helpdesk -- status              # health check
npm run helpdesk -- tickets             # simulated tickets
npm run helpdesk -- show SIM-1009       # read one
npm run simulate -- --count 3           # 3 simulated customers order and open tickets
npm run helpdesk -- restart             # after code changes: build + restart the live site
```

Hard rules:

- Never print secrets from `.env.local`.
- The demo store holds real customer data: only write simulated rows (`#S…` orders, `@customers.bb-sim.test` emails), never touch real ones or the `shop-sim` Worker.
- The site is on the public internet behind a Caddy login (everything except the SES webhook): don't expose store or customer data through new endpoints, and don't narrow that login.
- Ask before resetting data or changing Caddy, systemd or Cloudflare settings.
