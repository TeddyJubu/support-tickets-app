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
  await expect(page.getByRole("switch")).toContainText("Sending enabled");
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

test("sending explains its temporary access and notes remain available", async ({ page }) => {
  await signIn(page);
  await page.locator('[data-ticket-id]', { hasText: "Shipping time" }).click();
  await expect(page.getByRole("switch", { name: "Enable sending for 30 minutes" })).toBeVisible();
  await expect(page.getByText("You can write a draft.", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: "Internal note" }).click();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await page.getByLabel("Internal note", { exact: true }).fill("A draft note");
  await expect(page.getByRole("button", { name: "Add note" })).toBeEnabled();
});

test("copilot names its input and selected ticket; simulator never claims zero spend", async ({ page }) => {
  await signIn(page);
  await page.locator('[data-ticket-id]', { hasText: "Shipping time" }).click();
  await expect(page.getByRole("complementary", { name: "Ticket side panel" })).toBeHidden();
  await page.getByRole("button", { name: "AI copilot", exact: true }).click();
  await expect(page.getByText(/Current ticket: SIM-.*Shipping time/)).toBeVisible();
  await expect(page.getByLabel("Ask the copilot about this ticket")).toBeVisible();
  await expect(page.getByText("Select conversation", { exact: false })).toHaveCount(0);
  await page.route("**/api/chat", (route) => route.fulfill({ status: 503, json: { error: "AI is unavailable in this browser test" } }));
  const asked = page.waitForRequest("**/api/chat");
  await page.getByLabel("Ask the copilot about this ticket").fill("Summarize this ticket");
  await page.getByRole("button", { name: "Ask copilot", exact: true }).click();
  await asked;
  await expect(page.getByRole("heading", { name: "Investigate this ticket" })).toHaveCount(0);
  await expect(page.getByLabel("Ask the copilot about this ticket")).toBeVisible();
  await page.getByRole("tab", { name: "Customer", exact: true }).click();
  await expect(page.getByText(/Store orders and lifetime spend are unavailable for simulated customers/)).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No orders", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "/tmp/helpdesk-ui-inbox.png" });
});

test("archive has a system export notice, no composer, and a page jump", async ({ page }) => {
  await signIn(page);
  const list = await (await page.request.get("/api/helpdesk/tickets?source=sim")).json();
  const detail = await (await page.request.get(`/api/helpdesk/tickets/${list.tickets[0].id}`)).json();
  const archiveTicket = { ...detail.ticket, id: "ARCH-1", simulated: false, channel: "email", subject: "Archived shipping question" };
  await page.route("**/api/helpdesk/tickets?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("source") !== "history") return route.continue();
    const offset = Number(params.get("offset") || 0);
    await route.fulfill({ json: { tickets: [{ ...archiveTicket, id: `ARCH-${offset + 1}` }], total: 35955 } });
  });
  await page.route(/\/api\/helpdesk\/tickets\/ARCH-\d+$/, async (route) => {
    const id = route.request().url().split("/").pop();
    await route.fulfill({ json: { ...detail, ticket: { ...archiveTicket, id }, messages: undefined, ai: undefined, history: [] } });
  });
  await page.getByRole("tab", { name: "Archive", exact: true }).click();
  await expect(page).toHaveTitle(/^Archive ·/);
  await expect(page.getByText("Read-only archive.", { exact: false })).toBeVisible();
  await expect(page.getByText("Message text isn't included in the Gorgias export.", { exact: false })).toBeVisible();
  await expect(page.locator("#reply-box")).toHaveCount(0);
  await expect(page.getByText("Sends a real email", { exact: true })).toHaveCount(0);
  await page.getByLabel("Jump to page").fill("100");
  await page.getByLabel("Jump to page").press("Enter");
  await expect(page.locator('[data-ticket-id="ARCH-2476"]')).toBeVisible();
});

test("main navigation has stable positions and distinct page titles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  const inboxX = (await page.getByRole("navigation", { name: "Main navigation" }).boundingBox())!.x;
  for (const [path, title] of [["/kb", "Knowledge base"], ["/overview", "Overview"], ["/alerts", "Alerts"], ["/settings", "Settings"]]) {
    await page.goto(path);
    await expect(page).toHaveTitle(new RegExp(`^${title} ·`));
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await expect(navigation.getByRole("link", { name: "Knowledge base" })).toBeVisible();
    expect(Math.abs((await navigation.boundingBox())!.x - inboxX)).toBeLessThan(2);
  }
});

test("articles show loading before results and new articles start with a title", async ({ page }) => {
  await signIn(page);
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/kb/articles**", async (route) => {
    await waiting;
    await route.continue();
  });
  await page.goto("/kb");
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Loading articles" })).toBeVisible();
  await expect(page.getByText("No articles yet.", { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByText("Shipping Policy", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "New article", exact: true }).click();
  await page.getByLabel("Article title", { exact: true }).fill("Gift wrapping policy");
  await expect(page.getByText(/gift-wrapping-policy\.md/)).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Gift wrapping policy", exact: true })).toBeVisible();
});
