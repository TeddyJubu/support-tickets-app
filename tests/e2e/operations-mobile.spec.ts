import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Username").fill("e2e-owner");
  await page.getByLabel("Password").fill("e2e-password-123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("[data-ticket-id]").first()).toBeVisible();
}

test("alerts and overview keep their content and actions within a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  const now = new Date().toISOString();
  const longSubject = "Critical: return and exchange request for the birthday dress because the wrong size, missing ribbon, and international shipping questions all need follow-up";
  await page.route("**/api/alerts?**", (route) =>
    route.fulfill({
      json: {
        alerts: [
          {
            id: 9001,
            kind: "urgent_ticket",
            ticketId: "SIM-9001",
            severity: "critical",
            subject: longSubject,
            status: "skipped",
            attempts: 0,
            recipient: null,
            lastError: "Rate limit: 30 alert emails per hour. Retry only after the time shown; the cap is checked before sending.",
            createdAt: now,
            sentAt: null,
            nextAttemptAt: "2099-10-24T12:00:00.000Z",
          },
          {
            id: 9002,
            kind: "worker_down",
            ticketId: null,
            severity: null,
            subject: "Delivery problem: the international package has not arrived before the birthday and the carrier has not replied",
            status: "failed",
            attempts: 4,
            recipient: "owner@example.test",
            lastError: "The email service could not confirm delivery. Please check the support mailbox and contact the mail provider if this continues.",
            createdAt: now,
            sentAt: null,
            nextAttemptAt: null,
          },
        ],
        total: 2,
        offset: 0,
        limit: 25,
        recipients: 1,
      },
    }),
  );

  await page.goto("/alerts");
  const alertList = page.getByRole("region", { name: "Owner alert list" });
  await expect(alertList).toBeVisible();
  await expect(alertList.getByText(longSubject, { exact: false })).toBeVisible();
  await expect(alertList.getByText(/Emails are capped at 30 per hour/)).toBeVisible();
  const retry = alertList.getByRole("button", { name: "Retry" }).first();
  await expect(retry).toBeVisible();
  const retryBox = await retry.boundingBox();
  expect(retryBox).not.toBeNull();
  expect(retryBox!.x + retryBox!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const longName = "CustomerWithAnExtremelyLongUnbrokenDisplayNameThatUsedToForceGridExpansion";
  await page.route("**/api/overview", (route) =>
    route.fulfill({
      json: {
        escalations: { ok: true, data: [{ id: "SIM-9003", subject: "Question about an unusually long international package delivery and birthday replacement request", priority: "critical", status: "open", assignee: null, priorityReason: "The customer reports a missed birthday delivery and requests immediate help.", updatedAt: now }] },
        workload: { ok: true, data: { byStatus: { open: 3, pending: 1 }, openByPriority: { critical: 1, high: 1 }, unassigned: 1 } },
        ai: { ok: true, data: { last24h: { created: 1, used: 0, dismissed: 0, needsStaff: 0 }, queue: { pending: 2, retry_wait: 1, failed: 0 }, queueCheckedAt: now } },
        activity: { ok: true, data: [{ actor: longName, action: "reply", ticketId: "SIM-9003", at: now }] },
        learning: { ok: true, data: { total: 0, pending: 0, promoted: 0, withAiDraft: 0, aiDraftEdited: 0 } },
        ops: { ok: true, data: { state: "fresh", ageSeconds: 10, status: { at: now, checks: { offsiteBackups: { ok: false, detail: "local only" }, knowledgeBase: { ok: true, detail: "Index is ready" } } } } },
      },
    }),
  );
  await page.goto("/overview");
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(page.getByText(longName, { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
