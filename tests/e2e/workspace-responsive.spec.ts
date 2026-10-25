import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("e2e-owner");
  await page.getByLabel("Password").fill("e2e-password-123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("[data-ticket-id]").first()).toBeVisible();
}

test("phone inbox opens a full conversation and preserves a draft when returning to the same ticket", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.getByRole("main")).toBeHidden();
  const row = page.locator("[data-ticket-id]", { hasText: "Shipping time" });
  await row.click();
  await expect(page.getByRole("button", { name: "Back to tickets" })).toBeFocused();
  const reply = page.getByLabel("Reply", { exact: true });
  await reply.fill("Keep this unsent draft while I check the ticket list.");
  const send = await page.getByRole("button", { name: "Review & send", exact: true }).boundingBox();
  expect(send).not.toBeNull();
  expect(send!.x + send!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole("button", { name: "Back to tickets" }).click();
  await expect(row.getByRole("button").first()).toBeFocused();
  await row.click();
  await expect(reply).toHaveValue("Keep this unsent draft while I check the ticket list.");

  await page.getByRole("button", { name: "Customer details", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Ticket side panel", exact: true });
  await expect(panel).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Customer details", exact: true })).toBeFocused();
});

test("phone notification links open their conversation directly", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/?ticket=SIM-1001");
  await expect(page.getByRole("button", { name: "Back to tickets" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Shipping time/ })).toBeVisible();
});

test("reselecting a desktop ticket keeps the reply and modal review blocks workspace shortcuts", async ({ page }) => {
  await signIn(page);
  const row = page.locator("[data-ticket-id]", { hasText: "Shipping time" });
  await row.click();
  const reply = page.getByLabel("Reply", { exact: true });
  await reply.fill("Unsent reply retained after clicking the selected ticket.");
  const detailRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/helpdesk/tickets/SIM-1001") detailRequests.push(request.url());
  });
  await row.click();
  await expect(reply).toHaveValue("Unsent reply retained after clicking the selected ticket.");
  expect(detailRequests).toHaveLength(0);
  const before = await (await page.request.get("/api/helpdesk/tickets/SIM-1001")).json();
  await page.getByRole("switch").click();
  await page.getByRole("button", { name: "Review & send", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review before sending" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm & send", exact: true }).focus();
  await page.keyboard.press("e");
  const response = await page.request.get("/api/helpdesk/tickets/SIM-1001");
  const detail = await response.json();
  expect(detail.ticket.status).toBe(before.ticket.status);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
});

test("keyboard-shortcut help stays inside a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 480 });
  await signIn(page);
  await page.getByRole("button", { name: /Shortcuts/ }).click();
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
