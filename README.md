# Support Tickets App

> AI-powered customer support ticket management system with 17 tools and rich Gen UI components.

## Features Showcased

### AI Tools (17 Total)

**Generative UI Tools**

- `draft_response` - Draft email responses with editable preview
- `compose_email` - Email composition with templates

**Analysis Tools**

- `analyze_sentiment` - Customer emotion analysis with visual indicators
- `assess_customer_risk` - Churn risk assessment with recommendations
- `get_customer_context` - Customer history and insights

**Knowledge & Suggestions**

- `search_knowledge_base` - FAQ and help article lookup
- `get_resolution_suggestions` - AI-powered solution recommendations
- `find_similar_tickets` - Related ticket discovery

**Action Tools**

- `offer_compensation` - Discount/compensation workflow
- `schedule_callback` - Appointment booking
- `escalate_ticket` - Support escalation workflow
- `process_product_exchange` - Item replacement flow
- `process_refund` - Refund confirmation

**Data Display Tools**

- `get_customer_profile` - Full customer details card
- `get_order_details` - Order information display
- `get_ticket_summary` - Current ticket overview

### Custom UI Components

- 15+ tool card components with rich visualizations
- Skeleton loading states for all tools
- Customer conversation view with message history
- Sidebar with ticket navigation
- Real-time dashboard context

### SDK Patterns Demonstrated

- `useTool` with custom `render` functions for Gen UI
- `useAIContext` for real-time ticket data sync
- Dashboard context provider for state management
- Tool cards with loading skeletons
- Compound components for layout

## Quick Start

This is a standalone copy of `examples/support-tickets-demo` from the [Copilot SDK repo](https://github.com/YourGPT/copilot-sdk). It installs `@yourgpt/copilot-sdk` and `@yourgpt/llm-sdk` from npm, so it does not need the monorepo or pnpm.

### Prerequisites

- Node.js 20+
- Cloudflare account ID and an API token with Workers AI access

### Installation

```bash
npm install
cp .env.example .env.local   # then add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN
npm run helpdesk -- set-password   # the password you sign in with
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Store Data

The app runs on real store exports (Shopify customers and products, Gorgias tickets) loaded into a local SQLite database:

```bash
# Put the CSVs in data/exports/ (customers_export.csv, products_export_*.csv, tickets-part-*.csv)
npm run seed
```

This writes `data/helpdesk.db` using Node's built-in `node:sqlite` (Node 22+). `data/` is gitignored and never served to the browser; the UI and AI tools read it through `app/api/helpdesk/*` (see `lib/helpdesk-db.ts`). Re-run `npm run seed` after replacing the exports.

The Gorgias export contains ticket metadata (subject, tags, intent, timing, message counts) but no message bodies, so the conversation view and the AI work from that metadata.

Every page and API route requires signing in (`proxy.ts`, `lib/auth.ts`): one shared password, set with `npm run helpdesk -- set-password`, and a 12-hour session cookie. The simulator and the control CLI use `Bearer SIM_API_KEY` instead; the SES webhook checks its own token. Search engines are also blocked via `robots.txt`, a `noindex` robots meta tag and an `X-Robots-Tag` header on every response.

## Customer Simulator

Simulated customers replay real support history so you can test the helpdesk end to end. They show up under the **Simulated** tab with full email conversations; the **History** tab is the read-only Gorgias export.

```bash
npm run simulate -- --count 5        # open 5 new tickets
npm run simulate -- --follow-ups     # simulated customers answer your replies
npm run simulate -- --loop --interval 120 --count 2   # keep going until Ctrl+C
npm run simulate -- --intent Return  # only replay return requests
npm run simulate -- --reset          # delete all simulated tickets
```

Each run picks real customer tickets (by a Shopify customer, with a real support intent), gives the customer a stable pseudonym on the reserved `.test` domain, and has Workers AI write the email from the ticket's subject, intent and tags. Real names, emails and addresses never leave the server. When you reply to a simulated ticket, `--follow-ups` makes the customer answer in context; a customer reply reopens the ticket.

Simulated tickets live in `data/sim.db`, written through `/api/helpdesk/sim/*` (simulator calls need `SIM_API_KEY`).

### Demo store (shop-sim)

The private demo store is the `shop-sim` Worker and its D1 database. The Worker isn't reachable from the internet, so the simulator and helpdesk use the database directly through Cloudflare's D1 API (`lib/store-d1.mjs`). With `SHOP_D1_TOKEN` (an API token with **D1: Edit**) and `SHOP_D1_DATABASE_ID` in `.env.local`, the simulator places an order for each simulated customer before opening the ticket, and the AI can look it up with `get_order_details`.

- Simulated customers are added to the store as pseudonyms tagged `simulated`; simulated orders are named `#S1001`, `#S1002`, … with numbers far above the real ones.
- The store's variant prices are all `0.00`, so the simulator prices items from the product export.
- The helpdesk only looks up orders that simulated tickets reference; the store itself holds real customer data.

## Deploy

Deploy like any Next.js app (e.g. import the folder into Vercel) and set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the project's environment variables.

## Environment Variables

The chat route (`app/api/chat/route.ts`) calls [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) through its OpenAI-compatible endpoint (`https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1`).

| Variable                | Description                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (required)                                |
| `CLOUDFLARE_API_TOKEN`  | API token with Workers AI permission (required)                      |
| `CF_MODEL`              | Workers AI model with function calling, default `@cf/zai-org/glm-5.3-flash` |
| `HELPDESK_PASSWORD_HASH`, `SESSION_SECRET` | Web sign-in (required); set both with `npm run helpdesk -- set-password` |

See the [Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/) for other models that support function calling.

## Project Structure

```
support-tickets-app/
├── app/
│   ├── page.tsx                    # Main dashboard page
│   ├── layout.tsx                  # Root layout with providers
│   ├── globals.css                 # Tailwind styles
│   ├── api/
│   │   └── chat/route.ts           # Copilot API endpoint
│   └── components/
│       ├── ticketing-tools.tsx     # All 17 AI tools definitions
│       ├── types.ts                # TypeScript interfaces
│       ├── context/
│       │   └── dashboard-context.tsx
│       ├── data/
│       │   └── mock-data.ts        # Sample tickets & customers
│       ├── layout/
│       │   ├── conversation-area.tsx
│       │   ├── copilot-panel.tsx
│       │   ├── demo-sidebar.tsx
│       │   ├── ticket-header.tsx
│       │   └── message.tsx
│       └── tool-cards/             # 15+ Gen UI components
│           ├── draft-response-card.tsx
│           ├── sentiment-card.tsx
│           ├── customer-profile-card.tsx
│           └── ...
├── components/
│   └── theme-provider.tsx
├── lib/
│   └── utils.ts
└── README.md
```

## Testing the AI Workflow

1. Open the app - you'll see a sample support ticket
2. Ask the Copilot: "What's the customer's issue?"
3. The AI will use tools to:
   - Get ticket summary
   - Analyze customer sentiment
   - Fetch customer context
4. Ask: "Draft a response" to see the Gen UI response composer
5. Try: "Check for similar tickets" or "Suggest resolutions"

## Tech Stack

- Next.js 16
- React 19
- Tailwind CSS 4
- @yourgpt/copilot-sdk
- @yourgpt/llm-sdk
