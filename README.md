# Buttons Bebe support helpdesk

A support inbox for Buttons Bebe (a children's clothing store), live at https://helpdesk.teddyonfriday.com behind staff sign-in. It brings over the features of the production Shopify helpdesk (except Gorgias) on its own stack: Next.js 16, TypeScript, `node:sqlite`, Cloudflare Workers AI.

Operating it: see [AGENTS.md](AGENTS.md) and the `helpdesk-control` skill ([SKILL.md](.claude/skills/helpdesk-control/SKILL.md), [reference.md](.claude/skills/helpdesk-control/reference.md)). First deployment of these features: [docs/GO-LIVE.md](docs/GO-LIVE.md). What was ported and why: [docs/PORT-PLAN.md](docs/PORT-PLAN.md).

## What it does

- **Inbox**: simulated customers, real email (AWS SES) and staff-opened tickets. Views (Needs reply, Waiting, Assigned to me, Unassigned, Snoozed, Closed, Trash, Spam) with counts, filters, bulk actions, tags, snooze, per-person read state, internal notes, attachments, ticket history.
- **Automatic AI drafts**: every customer message is triaged by a deterministic, escalate-only classifier and drafted in the background by a worker using Workers AI and read-only tools (knowledge base, the ticket's order and returns, the customer's other tickets). Drafts are cleaned, and anything risky becomes "Needs staff input". Nothing is ever sent by the AI.
- **Safe sending**: Read & write (30 minutes), review of exactly what goes to whom, confirm with an idempotency key; a newer customer message or a changed reply cancels the review; an unconfirmed send blocks new replies until a person settles it.
- **Knowledge base**: Markdown articles in `data/kb/` with hybrid search (keywords + multilingual embeddings), an editor, product articles synced daily from the catalog, a Notice Board that overrides articles, and a learning loop that turns approved replies into masked examples.
- **Copilot**: the side-panel chat with tools for the KB, customers, products, orders, similar tickets and drafting.
- **Customer rail**: the email sender's Shopify customer record, matched order, items, shipping, refunds and order history (read-only, verified senders' own orders only), cached with a stale fallback.
- **Operations**: owner alert emails for urgent tickets, a worker heartbeat check, notifications, an Overview page, an ops monitor, encrypted backups with restore checks.
- **Test system**: a customer simulator (`npm run simulate`); simulated tickets have no store data.

## Development

```bash
npm ci
npm test                 # unit, route and safety tests (scratch data, fake AI/email/store)
npm run qa               # scenario checks (offline); --live drafts with Workers AI for grading
npm run verify           # the full release gate CI runs (adds lint, typecheck, build, browser tests)
npm run dev              # dev server; create a user first: npm run helpdesk -- user add me --owner
npm run worker           # the background worker (AI drafts, alerts, monitor, backups)
```

Data lives in `data/` (never committed): `sim.db` (inbox), `helpdesk.db` (store export, `npm run seed`), `kb/` and `kb.db` (knowledge base, `npm run kb -- import|index|products`), `backups/`.

Code map: `lib/` server logic (`sim-db`, `triage`, `sending`, `auth`, `classifier/`, `drafting/`, `kb/`, `learning`, `alerts`, `ops/`), `app/api/` routes, `app/components/` UI, `scripts/` CLI, worker and tools, `tests/` (`node --test`) and `tests/e2e/` (Playwright), `deploy/systemd/` unit files.
