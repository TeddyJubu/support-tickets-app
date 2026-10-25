import { expect, test, type Locator, type Page } from "@playwright/test";

// Separate scratch browser clients keep UI coverage within the real login rate limit.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "192.0.2.11" } });

const viewports = [
  { width: 1025, height: 746 },
  { width: 1025, height: 480 },
  { width: 390, height: 746 },
];

const initialMessage = "How long does shipping take to New Jersey?";
const nextStepEnd = "STAFF_NEXT_STEP_END_MARKER";
const missingFactsEnd = "MISSING_FACTS_END_MARKER";
const draftBodyEnd = "DRAFT_BODY_END_MARKER";
const kbRefsEnd = "KB_REFS_END_MARKER";
const flagsEnd = "DRAFT_FLAGS_END_MARKER";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("e2e-owner");
  await page.getByLabel("Password").fill("e2e-password-123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("[data-ticket-id]").first()).toBeVisible();
}

async function wheelConversation(page: Page, region: Locator, deltaY: number) {
  const bounds = await region.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(40);
}

async function textMarkerIntersectsRegion(locator: Locator, marker: string) {
  return locator.evaluate((element, needle) => {
    const region = element.closest('[aria-label="Ticket conversation"]');
    if (!region) return false;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const start = text.indexOf(needle);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + needle.length);
      const markerBounds = range.getBoundingClientRect();
      const regionBounds = region.getBoundingClientRect();
      return markerBounds.height > 0 &&
        markerBounds.bottom > regionBounds.top &&
        markerBounds.top < regionBounds.bottom &&
        markerBounds.right > regionBounds.left &&
        markerBounds.left < regionBounds.right;
    }
    return false;
  }, marker);
}

async function wheelUntilTextVisible(
  page: Page,
  region: Locator,
  locator: Locator,
  marker: string,
  direction: 1 | -1,
) {
  const bounds = await region.boundingBox();
  const stepHeight = Math.min(500, bounds!.height * 0.6);
  for (let step = 0; step < 150; step += 1) {
    if (await textMarkerIntersectsRegion(locator, marker)) return;
    await wheelConversation(page, region, direction * stepHeight);
  }
  expect(await textMarkerIntersectsRegion(locator, marker)).toBe(true);
}

async function withLongNeedsStaffDraft(page: Page) {
  // Read the real E2E scratch response so the conversation messages and ticket details stay
  // representative; only the draft fields are lengthened for this layout regression.
  const response = await page.request.get("/api/helpdesk/tickets/SIM-1001");
  expect(response.ok()).toBeTruthy();
  const detail = await response.json();
  expect(detail.ticket.id).toBe("SIM-1001");
  expect(detail.messages.some((message: { body: string }) => message.body === initialMessage)).toBe(true);
  expect(detail.ai?.draft).toBeTruthy();

  const staffNextStep = `STAFF_NEXT_STEP_START: ${"Check the latest carrier scan, confirm the delivery estimate, and document the verified result before replying. ".repeat(36)}${nextStepEnd}`;
  const missingFacts = Array.from(
    { length: 12 },
    (_, index) => `Missing detail ${index + 1}: ${"confirm the current shipment status and the customer’s preferred next step ".repeat(4)}`,
  );
  missingFacts[missingFacts.length - 1] += missingFactsEnd;
  const draftBody = [
    ...Array.from(
      { length: 84 },
      (_, index) => `Draft paragraph ${index + 1}: ${"We are checking the latest shipping information and will share the confirmed update with you. ".repeat(3)}`,
    ),
    draftBodyEnd,
  ].join("\n");
  const kbRefs = [
    "Shipping processing guidance with verified carrier timing and customer wording one",
    "Delivery estimate policy with verified carrier timing and customer wording two",
    "Shipment status procedure with verified carrier timing and customer wording three",
    `Customer update guidance with verified carrier timing and customer wording four ${kbRefsEnd}`,
  ];
  const flags = Array.from(
    { length: 8 },
    (_, index) => `Review flag ${index + 1}: check this long shipping and customer context before replying`,
  );
  flags[flags.length - 1] += ` ${flagsEnd}`;

  const mockedDetail = {
    ...detail,
    ai: {
      ...detail.ai,
      draft: {
        ...detail.ai.draft,
        action: "needs_staff",
        staffNextStep,
        missingFacts,
        kbRefs,
        flags,
        body: draftBody,
      },
    },
  };

  await page.route("**/api/helpdesk/tickets/SIM-1001", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", json: mockedDetail });
  });
}

for (const viewport of viewports) {
  test(`ticket conversation scrolls through the needs-staff draft and reply at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    await withLongNeedsStaffDraft(page);

    // The default inbox can already have this row selected on desktop. A direct ticket URL
    // guarantees the detail request happens after the route is installed on every viewport.
    await page.goto("/?ticket=SIM-1001");
    const region = page.getByRole("region", { name: "Ticket conversation", exact: true });
    const heading = region.getByRole("heading", { name: /^Shipping time/ });
    const customerMessage = region.getByText(initialMessage, { exact: true });
    await expect(heading).toBeVisible();
    await expect(customerMessage).toBeVisible();
    await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(0);
    expect(await region.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

    if (viewport.width === 1025 && viewport.height === 746) {
      await page.screenshot({ path: "/tmp/helpdesk-conversation-top.png" });
    }

    const nextStep = region.getByText(nextStepEnd, { exact: false });
    const missing = region.getByText(missingFactsEnd, { exact: false });
    const bodyEnd = region.getByText(draftBodyEnd, { exact: false });
    const refs = region.getByText(kbRefsEnd, { exact: false });
    const flags = region.getByText(flagsEnd, { exact: false });
    await wheelUntilTextVisible(page, region, nextStep, nextStepEnd, 1);
    await wheelUntilTextVisible(page, region, missing, missingFactsEnd, 1);
    await wheelUntilTextVisible(page, region, bodyEnd, draftBodyEnd, 1);
    await wheelUntilTextVisible(page, region, refs, kbRefsEnd, 1);
    await wheelUntilTextVisible(page, region, flags, flagsEnd, 1);

    const review = region.getByRole("button", { name: "Review & send", exact: true });
    await wheelUntilTextVisible(page, region, review, "Review & send", 1);
    await expect(review).toBeInViewport();
    if (viewport.width === 1025 && viewport.height === 746) {
      await page.screenshot({ path: "/tmp/helpdesk-conversation-bottom.png" });
    }

    const reply = region.getByLabel("Reply", { exact: true });
    const longReply = "This reply uses the confirmed shipping details and explains the next update we will provide. ".repeat(28);
    await reply.fill(longReply);
    const textareaLayout = await reply.evaluate((element: HTMLTextAreaElement) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(textareaLayout.clientHeight).toBeGreaterThan(100);
    expect(textareaLayout.scrollHeight).toBeLessThanOrEqual(textareaLayout.clientHeight + 2);
    expect(textareaLayout.scrollTop).toBe(0);
    expect(textareaLayout.overflowY).toBe("hidden");

    await wheelConversation(page, region, 12000);
    await expect(review).toBeInViewport();
    await wheelUntilTextVisible(page, region, customerMessage, initialMessage, -1);
    await expect(customerMessage).toBeInViewport();
    await wheelUntilTextVisible(page, region, heading, "Shipping time", -1);
    await wheelConversation(page, region, -12000);
    await expect(heading).toBeInViewport();
    await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(0);
  });
}
