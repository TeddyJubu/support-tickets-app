# Conversation scrolling follow-up

The compact 1025×746 inbox could clip the composer and hide the message history when a tall “Needs staff input” draft consumed the available height. The draft and composer were siblings of the only scrollable message section.

The ticket header, all loaded messages, complete AI draft, and reply composer now flow within one accessible “Ticket conversation” scroll region. Each section uses its natural height. Drafts no longer require Expand to read the full body, and replies grow with their text instead of introducing a second scrollbar. All loaded messages appear without a separate older-messages button. Opening a different ticket starts at its header; background refreshes preserve the reading position.

The ticket list and optional customer/copilot panel retain their own navigation. Reply review and explicit send confirmation remain required.

Validation: `npm test` and the complete `npm run verify` gate passed (secret scan, lint, typecheck, 166 unit/route/safety tests, 58 QA scenarios with no misses, production build, and 19 existing browser tests). Three additional wheel-driven Playwright cases passed at 1025×746, 1025×480, and 390×746 with an oversized needs-staff draft and a long reply. They check the full draft body, staff instructions, missing facts, references, flags, composer actions, growing textarea, and returning to the original customer message/header. Top and bottom screenshots were inspected visually. The browser checks use isolated scratch data with external credentials disabled.

Deployed with `npm run helpdesk -- restart`. Site and drafting worker are active, readiness is healthy, and the site returns HTTP 200. Public login/health/readiness checks return 200; signed-out ticket-data access returns 401.
