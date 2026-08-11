import { expect, test } from "@playwright/test";

const applicationRoutes = [
  "/dashboard",
  "/beneficiaries",
  "/activity",
  "/recovery",
  "/settings",
] as const;

test("landing presents the complete production feature story", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /continuity agent that acts/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /private alerts/i }),
  ).toBeVisible();
  await expect(page.getByText("Two monitored wallets")).toBeVisible();
  await expect(page.getByText(/Telegram never signs/i)).toBeVisible();
  await expect(
    page.locator("#operations").getByText("Owner-configured check-in"),
  ).toBeVisible();
  await expect(page.getByText("Wallet-scoped activity")).toBeVisible();
  await expect(page.getByText("Signed plan updates")).toBeVisible();
});

test("mobile landing fits the viewport and retains product identity", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByText("LegacyKeeper", { exact: true }).first()).toBeVisible();
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(geometry.content).toBeLessThanOrEqual(geometry.viewport);
  await expect(page.locator(".vault-scene")).toBeVisible();
});

test("keyboard focus is visible and primary controls meet touch targets", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus-visible");
  await expect(focused).toBeVisible();

  const sizes = await page.getByRole("button", { name: "Connect wallet" }).evaluateAll(
    (buttons) => buttons.map((button) => button.getBoundingClientRect()),
  );
  expect(sizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
});

test("hero vault responds to pointer hover", async ({ page }) => {
  await page.goto("/");
  const vault = page.locator(".vault-stack");
  const scene = page.locator(".vault-scene");
  const before = await vault.evaluate((element) =>
    getComputedStyle(element).transform,
  );

  await scene.hover({ position: { x: 1, y: 1 } });
  await expect
    .poll(() =>
      vault.evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe(before);
});

test("reduced motion freezes the hero tilt without hiding content", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const vault = page.locator(".vault-stack");
  const before = await vault.evaluate((element) => getComputedStyle(element).transform);
  await page.locator(".vault-scene").hover({ position: { x: 1, y: 1 } });
  await page.waitForTimeout(50);
  const after = await vault.evaluate((element) => getComputedStyle(element).transform);

  expect(after).toBe(before);
  await expect(
    page.getByRole("heading", { name: /private alerts/i }),
  ).toBeVisible();
});

for (const route of applicationRoutes) {
  test(`${route} keeps disconnected personal data behind the wallet gate`, async ({
    page,
  }) => {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: /Connect your wallet/i }),
    ).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });
}
