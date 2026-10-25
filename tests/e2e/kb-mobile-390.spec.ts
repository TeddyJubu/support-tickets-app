import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("e2e-owner");
  await page.getByLabel("Password").fill("e2e-password-123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("[data-ticket-id]").first()).toBeVisible();
}

test("KB article controls, expanded creation form, and long lists flow on a 390px phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  const path = "policies/shipping-policy.md";
  const raw = "---\ntitle: Shipping Policy\ncategory: policies\ntags: [shipping]\n---\n\n## Processing time\n\nOrders ship within 24 to 48 hours.\n";
  const articles = [
    {
      path,
      folder: "policies",
      title: "Shipping Policy",
      tags: ["shipping"],
      sensitive: false,
      status: "published",
      mtimeMs: 1,
    },
    ...Array.from({ length: 15 }, (_, index) => ({
      path: `policies/mobile-policy-${String(index + 1).padStart(2, "0")}.md`,
      folder: "policies",
      title: `Mobile test policy ${index + 1}`,
      tags: ["mobile"],
      sensitive: false,
      status: "published",
      mtimeMs: index + 2,
    })),
  ];

  await page.route("**/api/kb/articles**", (route) =>
    route.fulfill({
      json: {
        articles,
        folders: ["intents", "faq", "policies", "tickets", "learned", "products"],
        editableFolders: ["intents", "faq", "policies", "tickets", "learned"],
      },
    }),
  );
  await page.route("**/api/kb/article?*", (route) => {
    const requestedPath = new URL(route.request().url()).searchParams.get("path");
    if (requestedPath !== path) return route.fulfill({ status: 404, json: { error: "Article not found" } });
    return route.fulfill({
      json: {
        ...articles[0],
        raw,
        body: "## Processing time\n\nOrders ship within 24 to 48 hours.",
        editable: true,
        versions: 0,
      },
    });
  });

  await page.goto("/kb");
  const articleList = page.getByTestId("kb-article-list");
  await expect(articleList.getByRole("button", { name: /Shipping Policy/ })).toBeVisible();
  await articleList.getByRole("button", { name: /Shipping Policy/ }).click();
  const title = page.getByRole("heading", { name: "Shipping Policy", exact: true });
  const actions = page.getByTestId("kb-article-actions");
  await expect(title).toBeVisible();
  await expect(actions.getByRole("button", { name: "Preview" })).toBeVisible();

  const titleBox = await title.boundingBox();
  const actionsBox = await actions.boundingBox();
  expect(titleBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(titleBox!.width).toBeGreaterThan(250);
  expect(actionsBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
  expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(390);

  const listMetrics = await articleList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(listMetrics.overflowY).toBe("auto");
  expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight);

  await page.getByRole("button", { name: "New article" }).click();
  await page.getByRole("combobox", { name: "Folder", exact: true }).selectOption("policies");
  await page.getByLabel("Article title").fill("International returns and exchanges for delayed deliveries");
  const form = page.getByTestId("kb-new-article-form");
  await expect(form.getByText(/File: policies\/international-returns-and-exchanges-for-delayed-deliveries/)).toBeVisible();

  const controlsBox = await page.getByTestId("kb-article-controls").boundingBox();
  const formBox = await form.boundingBox();
  const listPaneBox = await page.getByTestId("kb-article-list-pane").boundingBox();
  const editorPaneBox = await page.getByTestId("kb-article-editor-pane").boundingBox();
  const expandedListMetrics = await articleList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(controlsBox).not.toBeNull();
  expect(formBox).not.toBeNull();
  expect(listPaneBox).not.toBeNull();
  expect(editorPaneBox).not.toBeNull();
  expect(formBox!.y).toBeGreaterThanOrEqual(controlsBox!.y);
  expect(formBox!.y + formBox!.height).toBeLessThanOrEqual(controlsBox!.y + controlsBox!.height);
  expect(controlsBox!.y + controlsBox!.height).toBeLessThanOrEqual(listPaneBox!.y + listPaneBox!.height);
  expect(listPaneBox!.y + listPaneBox!.height).toBeLessThanOrEqual(editorPaneBox!.y + 1);
  expect(expandedListMetrics.overflowY).toBe("auto");
  expect(expandedListMetrics.scrollHeight).toBeGreaterThan(expandedListMetrics.clientHeight);

  const content = page.getByText("Orders ship within 24 to 48 hours.", { exact: true });
  await content.scrollIntoViewIfNeeded();
  await expect(content).toBeInViewport();
  const contentBox = await content.boundingBox();
  const bodyBox = await page.getByTestId("kb-article-body").boundingBox();
  expect(contentBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();
  expect(contentBox!.y).toBeGreaterThanOrEqual(bodyBox!.y);
  expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(bodyBox!.y + bodyBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
