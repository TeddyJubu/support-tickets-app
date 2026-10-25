# Second visual review

Reviewed the built helpdesk with representative scratch data: long subjects and tags, repeated notifications, pending/failed/rate-limited alerts, backup warnings, and a connected-store state. Captured the main pages and knowledge-base tabs in both desktop themes, plus compact and phone layouts. No live customer records, store settings, or customer emails were changed during the review.

## Additional findings and fixes

1. **Reopening the selected ticket erased an unsent reply.** Selection now preserves the loaded ticket's reply and AI edits instead of resetting its state. Browser coverage checks both desktop re-selection and returning from the phone ticket list.
2. **The phone inbox squeezed the conversation off-screen.** Phones now show the ticket list or the full conversation, with an explicit Back to tickets action. Notification links and newly created tickets open the conversation. Merely displaying the phone ticket list no longer opens and marks the first ticket read.
3. **The header used unnecessary rows at compact widths.** The title and account share a row; labeled navigation occupies its own row below desktop widths. The profile editor remains inside the phone viewport.
4. **Compact customer/copilot panels covered reply controls while leaving the background interactive.** They now open as modal sheets with a backdrop, keyboard focus containment, Escape dismissal, and focus restoration. Wide desktop panels remain docked.
5. **Alerts clipped Retry actions on phones.** Phone alert cards keep subjects, status explanations, timestamps, and retry controls visible. Desktop retains the table. Loading and initial failure states now provide feedback and a retry action.
6. **Overview expanded beyond the phone viewport.** Its mobile grid and cards now allow content to shrink within the available width, including long staff names and subjects.
7. **Dialogs could extend beyond short windows, and New ticket did not contain keyboard focus.** New ticket has a scrollable body with its actions kept visible and returns focus on cancellation. Keyboard-shortcut help also scrolls inside the viewport.
8. **Workspace shortcuts could change a ticket behind an open dialog.** Ticket shortcuts now ignore open modals and events within dialogs and menus, including the send-review dialog.
9. **The phone knowledge-base editor squeezed its title and overlapped expanded article forms.** The mobile editor gives its title a full row and allows the article list/form and editor to flow vertically without overlapping. Desktop retains the side-by-side layout.

## Validation

The complete `npm run verify` gate passed: secret scanning, lint, typecheck, 166 unit/route/safety tests, 58 QA scenarios with no misses, the production build, and 19 Playwright tests. New browser checks cover 390px phone layouts, 1024px compact layouts, 1440px desktop navigation, 480px window height, draft preservation, deep links, modal focus, suppression of background ticket shortcuts, and a long knowledge-base article list with the creation form expanded.

Repeated the visual captures after the fixes. The 30-screen comparison reported no page-width overflow, clipped controls, or browser runtime errors in the measured states. Additional phone captures cover the ticket list, article view, new-article form, and Settings. This is a bounded review of those states; it is not a claim that every possible screen or data combination has been audited.

Deployed with `npm run helpdesk -- restart`. The site and drafting worker are active; production readiness and public health endpoints return HTTP 200. Signed-out requests to Overview, Shopify status, and ticket data return HTTP 401.
