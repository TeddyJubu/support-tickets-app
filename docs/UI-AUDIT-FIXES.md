# UI audit fixes

This record maps each of the 43 supplied findings to its implementation. Validation results are recorded below after the release checks.

## Validation

`npm test` and the complete `npm run verify` release gate passed: 166 unit, route, and safety tests; 58 QA scenarios with no misses; 11 Playwright browser tests; secret scanning; ESLint; TypeScript; and the production build. Browser coverage includes both copilot input views, temporary sending access, internal notes, archive restrictions and page jumping, stable navigation, KB loading, and title-based article creation. All browser actions used scratch data with service credentials disabled.

A canceled Turbopack task persisted in the generated build cache during integration. Moving only that cache into `/tmp` allowed a clean build; subsequent complete release checks passed. No application data was reset.

The live helpdesk and worker were rebuilt and restarted with the control CLI. Both services are active; the site, login, health, and readiness checks return HTTP 200. Signed-out Shopify status, Overview, and inbox APIs return HTTP 401. A separate scratch-data visual check confirmed dark-theme metadata at 13px and displayed times in a browser configured for Asia/Dhaka (GMT+6).

| # | Finding | Change |
| --- | --- | --- |
| 1 | Icon-only navigation | Main navigation has persistent text labels. |
| 2 | Navigation changes location | Inbox and console pages use the same `AppHeader`. |
| 3 | Navigation shifts with title | Header reserves a fixed desktop title slot. |
| 4 | Similar bell controls | Alerts and Notifications have separate visible labels. |
| 5 | Faint secondary text | Increased muted-text contrast in both themes. |
| 6 | Tiny important text | Dense metadata has a 12px minimum; secondary copy is larger. |
| 7 | Placeholder account name | Account identity can be corrected without inventing a staff member's name. |
| 8 | Inconsistent dates | Shared date/time formatters and explicit UTC parsing for database timestamps. |
| 9 | Missing timezones | Clock times include timezone labels; scheduling fields describe their timezone. |
| 10 | Identical browser titles | Page-specific titles, including the active Archive view. |
| 11 | Cramped rows | Wider ticket list and wrapping metadata rows. |
| 12 | Wrapped status | Status labels stay on one line. |
| 13 | Broken ticket IDs | Ticket IDs never wrap or shrink into fragments. |
| 14 | Truncated subjects | Two-line subjects and full-text hover descriptions. |
| 15 | Repetitive scenario tag | Scenario tags are excluded from the row's scanning metadata. |
| 16 | Narrow conversation | Side panel starts collapsed and overlays at intermediate widths. |
| 17 | Overlapping AI controls | Reply generation stays in the draft strip; rewriting and copilot investigation are explained. |
| 18 | Copilot selection ambiguity | Current ticket is explicit and the conversation picker is hidden. |
| 19 | Unnamed copilot input | Explicit visible label linked to the copilot textarea. |
| 20 | Ambiguous sending switch | “Enable sending for 30 minutes” states the action. |
| 21 | Hidden sending duration | Enabled switch shows a countdown and current-page scope. |
| 22 | Unexplained disabled sending | Explanation next to composer distinguishes writing, enabling, reviewing, and blocked sends. |
| 23 | Dominant close action | Close uses a secondary button; review/send retains primary emphasis. |
| 24 | Opaque AI progress | Queued, processing, retry, elapsed time, and long-running guidance are distinct. |
| 25 | Simulator zero values | Simulator spend/order facts and tiers are replaced by an unavailable explanation. |
| 26 | Filters cover list | Filters expand inline above the list. |
| 27 | Archive composer | Archive has no composer; client actions also refuse archive replies/changes. |
| 28 | Archive real-email contradiction | Archive shows a dedicated read-only notice with no sending badges. |
| 29 | Export limitation as customer speech | Missing message text appears as a system notice. |
| 30 | Archive navigation | Page-number jump supports direct access across large result sets. |
| 31 | Narrow notifications | Wider, viewport-bounded notification menu. |
| 32 | Ungrouped notifications | Events are grouped by ticket with their event details retained. |
| 33 | Unexplained repeated priority alerts | Priority changes describe the increase and retain event history. |
| 34 | False KB empty state | Loading and failure states are distinct from an empty article folder. |
| 35 | Truncated KB titles | Wider article list and multiline article titles. |
| 36 | Prominent internal filenames | Storage/version details are moved into secondary disclosures. |
| 37 | Filename-first article creation | Article title generates a validated safe filename. |
| 38 | Legacy store branding | Known legacy branding is normalized to the configured store for KB presentation/search and draft/rewrite output. Original source files are preserved. |
| 39 | Notice expiry timezone | Notice form labels browser timezone and shows a UTC equivalent. |
| 40 | Unexplained learning decisions | Review explains what approval learns, its scope, promotion timing, reversing decisions before promotion, and how to request withdrawal afterward. |
| 41 | Technical health warnings | Owner-facing explanations lead with impact and next steps; configuration details are secondary. |
| 42 | Raw events and confusing counts | Activity uses readable verbs; queue counts identify what is counted and when. |
| 43 | Recovery and connection guidance | Alerts expose retry eligibility; Settings provides an authenticated read-only connection check with check timestamps. |

## Boundaries

No customer email is sent automatically. Shopify remains read-only, and store checks read shop metadata only. Live customer data, knowledge-base source files, account names, deployment configuration, and store connections are not rewritten as part of the UI rollout. Staff may correct their own name through the account control. Archived source records retain their original content.
