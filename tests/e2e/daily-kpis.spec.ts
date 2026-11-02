import { test, expect } from "@playwright/test";

/** Daily Arena shows five KPI cards (no Spin Credits); Spin & Win stays available and unchanged. */
test.use({ storageState: { cookies: [], origins: [] } });

for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [390, 844]] as const) {
  test(`Daily KPIs at ${w}×${h}: five cards, no Spin Credits, no overflow; Spin & Win still in the navigation`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/");
    const bar = page.getByTestId("kpi-bar");
    await expect(bar).toBeVisible({ timeout: 60_000 });
    await expect(bar).toHaveAttribute("data-cards", "5");
    await expect(page.getByTestId("kpi-spin-credits")).toHaveCount(0);
    await expect(bar).not.toContainText(/SPIN CREDITS/i);
    for (const label of ["APPROVED SALES", "TODAY'S TARGET", "COMPLETION", "REMAINING", "ACTIVE AGENTS"]) await expect(bar).toContainText(label);
    const boxes = await bar.locator(":scope > div").evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), w: Math.round(b.width), right: Math.round(b.right) }; }));
    expect(boxes).toHaveLength(5);
    const barBox = (await bar.boundingBox())!;
    expect(Math.max(...boxes.map((b) => b.right))).toBeLessThanOrEqual(Math.ceil(barBox.x + barBox.width) + 1);
    if (w >= 1024) {
      expect(new Set(boxes.map((b) => b.top)).size).toBe(1); // one row
      expect(Math.max(...boxes.map((b) => b.w)) - Math.min(...boxes.map((b) => b.w))).toBeLessThanOrEqual(2); // evenly distributed
    } else {
      // Stacked: the last card spans the final row, so no empty slot is left.
      expect(Math.round(boxes[4].right)).toBe(Math.round(Math.max(...boxes.map((b) => b.right))));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (w === 1920) {
      const podium = (await page.getByTestId("top3-weekly").boundingBox())!;
      expect(podium.y + podium.height).toBeLessThanOrEqual(1080);
    }
    // Spin & Win is still offered in the navigation.
    if (w >= 768) await expect(page.getByRole("tablist", { name: "Live Arena screen" }).getByRole("tab", { name: /Spin & Win/ })).toBeVisible();
    else await expect(page.locator("header select option", { hasText: "Spin & Win" })).toHaveCount(1);
  });
}

test("Spin & Win screen is unchanged: wheel screen, spin credits and the manager's Demo Spin", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await expect(page.getByTestId("kpi-bar")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tablist", { name: "Live Arena screen" }).getByRole("tab", { name: /Spin & Win/ }).click();
  await expect(page.locator("[data-arena-mode=spin]")).toBeVisible();
  await expect(page.getByTestId("kpi-bar")).toHaveAttribute("data-cards", "6");
  await expect(page.getByTestId("kpi-spin-credits")).toBeVisible();
  await expect(page.getByRole("button", { name: /demo spin/i })).toBeVisible();
});
