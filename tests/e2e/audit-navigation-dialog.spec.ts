import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Username").fill("e2e-owner");
  await page.getByLabel("Password").fill("e2e-password-123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("[data-ticket-id]").first()).toBeVisible();
}

test("header keeps a single title/account row and places navigation consistently", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await signIn(page);

  const title = page.locator("header h1");
  const account = page.locator('header [role="group"][aria-label^="Account:"]');
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(title).toBeVisible();
  await expect(account).toBeVisible();
  let titleBox = await title.boundingBox();
  let accountBox = await account.boundingBox();
  let navBox = await navigation.boundingBox();
  expect(titleBox).not.toBeNull();
  expect(accountBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(Math.abs((titleBox!.y + titleBox!.height / 2) - (accountBox!.y + accountBox!.height / 2))).toBeLessThan(8);
  expect(navBox!.y).toBeGreaterThan(Math.max(titleBox!.y + titleBox!.height, accountBox!.y + accountBox!.height) - 1);
  expect(navBox!.x).toBeLessThan(20);
  expect(navBox!.width).toBeGreaterThan(360);

  await page.locator('header button[aria-label^="Profile:"]').click();
  const profile = page.getByRole("dialog", { name: "Edit your profile" });
  await expect(profile).toBeVisible();
  const profileBox = await profile.boundingBox();
  expect(profileBox).not.toBeNull();
  expect(profileBox!.x).toBeGreaterThanOrEqual(0);
  expect(profileBox!.x + profileBox!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1024, height: 768 });
  titleBox = await title.boundingBox();
  accountBox = await account.boundingBox();
  navBox = await navigation.boundingBox();
  expect(navBox!.y).toBeGreaterThan(Math.max(titleBox!.y + titleBox!.height, accountBox!.y + accountBox!.height) - 1);
  expect(navBox!.width).toBeGreaterThan(980);

  await page.setViewportSize({ width: 1440, height: 900 });
  const inboxNavX = (await navigation.boundingBox())!.x;
  await page.goto("/kb");
  await expect(page).toHaveTitle(/^Knowledge base ·/);
  await expect(page.locator("header h1")).toHaveText("Knowledge base");
  const kbNav = page.getByRole("navigation", { name: "Main navigation" });
  const kbNavBox = (await kbNav.boundingBox())!;
  const kbTitleBox = (await page.locator("header h1").boundingBox())!;
  expect(Math.abs(kbNavBox.x - inboxNavX)).toBeLessThan(2);
  expect(Math.abs(kbNavBox.y + kbNavBox.height / 2 - (kbTitleBox.y + kbTitleBox.height / 2))).toBeLessThan(10);
});

test("new-ticket dialog fits a short viewport and traps/restores keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await signIn(page);

  const trigger = page.getByRole("button", { name: "New ticket", exact: true }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "New ticket" });
  await expect(dialog).toBeVisible();
  const email = dialog.getByLabel("Customer email");
  await expect(email).toBeFocused();

  const dialogBox = (await dialog.boundingBox())!;
  expect(dialogBox.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(480);
  const create = dialog.getByRole("button", { name: "Create ticket" });
  const createBox = (await create.boundingBox())!;
  expect(createBox.y + createBox.height).toBeLessThanOrEqual(480);
  await expect(create).toBeVisible();

  const scrollRegion = dialog.locator("[data-dialog-scroll-region]");
  const hasOverflow = await scrollRegion.evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(hasOverflow).toBe(true);
  await scrollRegion.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => scrollRegion.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(create).toBeVisible();

  const note = dialog.getByLabel(/Internal note/);
  await note.focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(create).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(email).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(create).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  const reopened = page.getByRole("dialog", { name: "New ticket" });
  await reopened.getByRole("button", { name: "Cancel" }).click();
  await expect(reopened).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
