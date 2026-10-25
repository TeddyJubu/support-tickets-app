import { expect, test, type Page } from "@playwright/test";

// Separate scratch browser clients keep UI coverage within the real login rate limit.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "192.0.2.10" } });

const order1 = {
  name: "#1001",
  placedAt: "2026-10-10T15:00:00.000Z",
  total: 81,
  currency: "USD",
  payment: "Paid",
  fulfillment: "Unfulfilled",
  cancelledAt: null,
  subtotal: 70,
  shipping: 5,
  tax: 6,
  discounts: 10,
  itemsTruncated: false,
  items: [
    {
      title: "Floral romper",
      quantity: 2,
      price: 40,
      sku: "ROMPER-6M",
      variant: "Pink / 6M",
      image: { url: "https://cdn.shopify.com/test-romper.png", alt: "Pink romper" },
      lineTotal: 72,
    },
  ],
  shipments: [],
  refunds: [],
  refunded: null,
};

const order2 = {
  name: "#1000",
  placedAt: "2026-09-10T15:00:00.000Z",
  total: 42,
  currency: "USD",
  payment: "Paid",
  fulfillment: "Fulfilled",
  cancelledAt: null,
  subtotal: 40,
  shipping: 0,
  tax: 2,
  discounts: 0,
  itemsTruncated: false,
  items: [
    {
      title: "Other product",
      quantity: 1,
      price: 40,
      sku: "OTHER-1",
      variant: "Blue / 2T",
      image: null,
      lineTotal: 40,
    },
  ],
  shipments: [],
  refunds: [],
  refunded: null,
};

const olderOrder = {
  ...order2,
  name: "#900",
  placedAt: "2025-01-05T15:00:00.000Z",
  total: 30,
  subtotal: 30,
  shipping: 0,
  tax: 0,
  discounts: 0,
  items: [{ ...order2.items[0], title: "Vintage cardigan", price: 30, lineTotal: 30 }],
};

const storeFixture = {
  available: true,
  reason: null,
  snapshot: {
    schemaVersion: 2,
    customer: {
      name: "Maya Test",
      email: "maya@customers.bb-sim.test",
      phone: "+1 555 0100",
      location: "Newark, NJ, US",
      since: "2025-01-01T00:00:00Z",
      ordersCount: 2,
      totalSpent: 123,
      currency: "USD",
    },
    matchedOrder: order1,
    orders: [order1, order2],
    storeCredit: null,
    giftCards: null,
  },
  fetchedAt: "2026-10-25T12:00:00.000Z",
  stale: false,
  error: null,
  returns: [],
};

const unavailableStoreFixture = {
  available: false,
  reason: "No verified store customer exists for this ticket.",
  snapshot: null,
  fetchedAt: null,
  stale: false,
  error: null,
  returns: [],
};

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Username").fill("e2e-owner");
  await page.getByLabel("Password").fill("e2e-password-123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("[data-ticket-id]").first()).toBeVisible();
}

async function openTicketDetails(page: Page, ticketId = "SIM-1001") {
  await page.locator(`[data-ticket-id="${ticketId}"]`).click();
  const detailsButton = page.getByRole("region", { name: "Ticket conversation" }).getByRole("button", { name: "Details", exact: true });
  await detailsButton.click();
  return { detailsButton, panel: page.locator("#ticket-side-panel") };
}

async function mockRomperImage(page: Page) {
  await page.route("https://cdn.shopify.com/test-romper.png", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#f9a8d4"/></svg>',
    }),
  );
}

async function mockStore(page: Page, response: unknown = storeFixture, status = 200) {
  await page.route("**/api/helpdesk/tickets/SIM-1001/store**", (route) =>
    route.fulfill({ status, json: response }),
  );
}

test("desktop Details shows the matched order and expands earlier orders", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockRomperImage(page);
  await mockStore(page);
  await signIn(page);
  const { panel } = await openTicketDetails(page);

  await expect(panel).toBeVisible();
  const shopifyCustomer = panel.getByRole("region", { name: "Shopify customer", exact: true });
  await expect(shopifyCustomer.getByText("Maya Test", { exact: true })).toBeVisible();
  await expect(shopifyCustomer.getByText("maya@customers.bb-sim.test", { exact: true })).toBeVisible();
  await expect(shopifyCustomer.getByText("+1 555 0100", { exact: true })).toBeVisible();
  await expect(shopifyCustomer.getByText("Newark, NJ, US", { exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: /^Orders(?:\s+\(\d+\))?$/ })).toBeVisible();

  await expect(panel.getByText("Floral romper", { exact: true })).toBeVisible();
  const productImage = panel.getByRole("img", { name: "Pink romper", exact: true });
  await expect(productImage).toBeVisible();
  await expect(panel.getByText("Pink / 6M", { exact: true })).toBeVisible();
  await expect(panel.getByText("SKU: ROMPER-6M", { exact: true })).toBeVisible();
  await expect(panel.getByText("Quantity: 2", { exact: true })).toBeVisible();
  for (const amount of ["$40.00", "$72.00", "$70.00", "$5.00", "$6.00", "$10.00", "$81.00", "$123.00"]) {
    await expect(panel).toContainText(amount);
  }

  const previousOrder = panel.getByRole("button", { name: /#1000/ });
  await expect(previousOrder).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByText("Other product", { exact: true })).toBeHidden();
  await previousOrder.click();
  await expect(previousOrder).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByText("Other product", { exact: true })).toBeVisible();
  await expect(panel.getByRole("img", { name: "Product image unavailable", exact: true })).toBeVisible();

  await productImage.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/helpdesk-details-desktop.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  expect(await panel.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    await panel.evaluate((element) => element.clientWidth),
  );
});

test("phone Details keeps customer content in the viewport and restores focus on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 746 });
  await mockRomperImage(page);
  await mockStore(page);
  await signIn(page);
  const { detailsButton, panel } = await openTicketDetails(page);
  const dialog = page.getByRole("dialog", { name: "Ticket side panel", exact: true });

  await expect(dialog).toBeVisible();
  await expect(panel.getByRole("region", { name: "Shopify customer", exact: true }).getByText("Maya Test", { exact: true })).toBeVisible();
  await expect(panel.getByText("Floral romper", { exact: true })).toBeVisible();
  await panel.getByRole("img", { name: "Pink romper", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/helpdesk-details-phone.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(await panel.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    await panel.evaluate((element) => element.clientWidth),
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(detailsButton).toBeFocused();
});

test("store data can be retried and a delayed refresh shows its stale notice", async ({ page }) => {
  let initialAttempts = 0;
  let refreshAttempts = 0;
  await mockRomperImage(page);
  await page.route("**/api/helpdesk/tickets/SIM-1001/store**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("refresh")) {
      refreshAttempts += 1;
      return route.fulfill({
        json: refreshAttempts === 1 ? storeFixture : { ...storeFixture, stale: true, error: "Shopify refresh failed" },
      });
    }
    initialAttempts += 1;
    if (initialAttempts === 1) {
      return route.fulfill({ status: 503, json: { error: "Shopify temporarily unavailable" } });
    }
    return route.fulfill({ json: storeFixture });
  });
  await signIn(page);
  const { panel } = await openTicketDetails(page);

  const retry = panel.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(panel.getByRole("region", { name: "Shopify customer", exact: true }).getByText("Maya Test", { exact: true })).toBeVisible();
  const refresh = panel.getByRole("button", { name: "Refresh store data", exact: true });
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect(panel.getByText(/Refresh delayed: showing the last successful read/)).toBeVisible();
});

test("switching tickets does not let a late store response replace the new customer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let releaseFirst: () => void = () => {};
  let firstStarted: () => void = () => {};
  let firstFinished: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstRequest = new Promise<void>((resolve) => { firstStarted = resolve; });
  const firstResponse = new Promise<void>((resolve) => { firstFinished = resolve; });

  await mockRomperImage(page);
  await page.route("**/api/helpdesk/tickets/*/store**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/SIM-1001/store")) {
      firstStarted();
      await firstGate;
      await route.fulfill({ json: storeFixture });
      firstFinished();
      return;
    }
    if (url.pathname.endsWith("/SIM-1002/store")) {
      await route.fulfill({ json: unavailableStoreFixture });
      return;
    }
    await route.continue();
  });

  await signIn(page);
  const { panel } = await openTicketDetails(page);
  await firstRequest;
  await page.locator('[data-ticket-id="SIM-1002"]').click();
  await expect(panel.getByText(unavailableStoreFixture.reason, { exact: true })).toBeVisible();
  releaseFirst();
  await firstResponse;
  await expect(panel.getByText("Maya Test", { exact: true })).toHaveCount(0);
  await expect(panel.getByText(unavailableStoreFixture.reason, { exact: true })).toBeVisible();
});

test("order lookup failures add nothing and a scoped success shows an older order", async ({ page }) => {
  await mockRomperImage(page);
  await mockStore(page);
  const lookupUrls: string[] = [];
  let attempts = 0;
  await page.route("**/api/helpdesk/orders**", async (route) => {
    const url = new URL(route.request().url());
    lookupUrls.push(url.href);
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 404, json: { error: "Order not found for this ticket" } });
      return;
    }
    await route.fulfill({ json: { order: olderOrder } });
  });
  await signIn(page);
  const { panel } = await openTicketDetails(page);

  const number = panel.getByRole("textbox", { name: "Order number", exact: true });
  await number.fill("#900");
  await panel.getByRole("button", { name: "Find order", exact: true }).click();
  await expect(panel.getByText("Order not found for this ticket", { exact: true })).toBeVisible();
  await expect(panel.getByText("#900", { exact: true })).toHaveCount(0);

  await panel.getByRole("button", { name: "Find order", exact: true }).click();
  await expect(panel.getByText("#900", { exact: true })).toBeVisible();
  expect(lookupUrls).toHaveLength(2);
  for (const value of lookupUrls) {
    const url = new URL(value);
    expect(url.searchParams.get("ticket")).toBe("SIM-1001");
    expect(url.searchParams.get("name")).toBe("#900");
  }
});


test("long orders load the remaining products through the ticket-scoped lookup", async ({ page }) => {
  await mockRomperImage(page);
  const preview = { ...order1, itemsTruncated: true };
  await mockStore(page, { ...storeFixture, snapshot: { ...storeFixture.snapshot, matchedOrder: preview, orders: [preview, order2] } });
  let requestedTicket = "";
  await page.route("**/api/helpdesk/orders**", async (route) => {
    requestedTicket = new URL(route.request().url()).searchParams.get("ticket") ?? "";
    await route.fulfill({ json: { order: { ...order1, items: [...order1.items, { ...order2.items[0], title: "Last product" }] } } });
  });
  await signIn(page);
  const { panel } = await openTicketDetails(page);
  await panel.getByRole("button", { name: "Load remaining products", exact: true }).click();
  await expect(panel.getByText("Last product", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Load remaining products", exact: true })).toHaveCount(0);
  expect(requestedTicket).toBe("SIM-1001");
});
