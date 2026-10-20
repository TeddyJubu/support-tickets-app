import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, username = "e2e-owner") {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("e2e-password-123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("[data-ticket-id]").first()).toBeVisible();
}

test("wrong password is refused, the right one opens the inbox", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("e2e-agent");
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong username or password")).toBeVisible();
  await signIn(page, "e2e-agent");
  await expect(page.getByText("Alex Agent")).toBeVisible();
});

test("views and filters narrow the list", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /^All/ }).first().click();
  await page.getByRole("menuitemradio", { name: /Unassigned/ }).click();
  await expect(page.locator("[data-ticket-id]")).toHaveCount(3);
  await page.getByTitle("Filter and sort").click();
  await page.getByLabel("Priority").selectOption("critical");
  await expect(page.getByText("No matching tickets")).toBeVisible();
});

test("bulk action sets priority on the selected tickets", async ({ page }) => {
  await signIn(page);
  const rows = page.locator("[data-ticket-id]");
  await rows.nth(0).hover();
  await rows.nth(0).getByRole("checkbox").check();
  await rows.nth(1).getByRole("checkbox").check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Set priority" }).click();
  await page.getByRole("menuitem", { name: "High" }).click();
  await expect(page.getByText(/Priority high: 2 tickets/)).toBeVisible();
});

test("use the AI draft, review it, confirm and send", async ({ page }) => {
  await signIn(page);
  await page.locator('[data-ticket-id]', { hasText: "Shipping time" }).click();
  await expect(page.getByText("AI draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use draft" }).click();
  await expect(page.locator("#reply-box")).toHaveValue(/24 to 48 hours/);
  // Read-only until switched on
  await expect(page.getByRole("button", { name: "Review & send" })).toBeDisabled();
  await page.getByRole("switch").click();
  await expect(page.getByRole("switch")).toContainText("Read & write");
  await page.getByRole("button", { name: "Review & send" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("maya@customers.bb-sim.test");
  await expect(dialog).toContainText("How long does shipping take");
  await dialog.getByRole("button", { name: "Confirm & send" }).click();
  await expect(page.getByText("Reply sent to the simulated customer")).toBeVisible();
  await expect(page.locator("text=USPS takes about 7 to 14 days").first()).toBeVisible();
});

test("internal notes stay internal", async ({ page }) => {
  await signIn(page);
  await page.locator('[data-ticket-id]', { hasText: "Gift wrap" }).click();
  await page.getByRole("tab", { name: "Internal note" }).click();
  await page.locator("#reply-box").fill("Checked with the warehouse: gift wrap is available.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Internal note", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Checked with the warehouse")).toBeVisible();
});

test("the owner edits a KB article", async ({ page }) => {
  await signIn(page);
  await page.goto("/kb");
  await page.getByText("Shipping Policy").first().click();
  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByLabel("Article Markdown");
  await editor.fill((await editor.inputValue()).replace("24 to 48 hours", "1 to 2 business days"));
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Re-index to apply it to AI answers.")).toBeVisible();
});
