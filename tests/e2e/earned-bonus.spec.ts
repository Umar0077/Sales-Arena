import { test, expect, type Page } from "@playwright/test";

/**
 * Leaderboard / podium earned-bonus indicators render exactly what the server returns from
 * bonus_awards. The awards response is intercepted in the browser (nothing is written to any
 * database and no award is created); the per-agent shape is the real API's.
 */
async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("top3-weekly")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("closer-rows").locator("li").first()).toBeVisible();
}

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 } });

test("indicators show the stored amounts per agent and period, nothing for agents without awards", async ({ page }) => {
  let codes: string[] = [];
  await page.route("**/api/arena/awards**", async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    if (codes.length) {
      j.agentBonus = {
        currency: "PKR",
        byAgent: { [codes[0]]: { currency: "PKR", day: { earned: 2000, count: 1 }, week: { earned: 5000, count: 2 }, month: { earned: 5000, count: 2 } } },
      };
    }
    await route.fulfill({ response: res, json: j });
  });
  await open(page);
  // Real agents from the live leaderboard (no names or codes hard-coded).
  codes = await page.getByTestId("closer-rows").locator("li[data-code]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code!.toUpperCase()));
  expect(codes.length).toBeGreaterThan(1);
  await page.getByRole("button", { name: /refresh/i }).first().click();

  const row = page.getByTestId("closer-rows").locator(`li[data-code="${codes[0]}" i]`);
  await expect(row.getByTestId("earned-bonus")).toHaveText("Earned today: PKR 2,000", { timeout: 15_000 });
  await expect(page.getByTestId("closer-rows").locator(`li[data-code="${codes[1]}" i]`).getByTestId("earned-bonus")).toHaveCount(0);

  const podium = page.getByTestId("top3-weekly");
  const cards = podium.locator("li");
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const code = (await card.getAttribute("data-code"))?.toUpperCase();
    await expect(card.getByTestId("earned-bonus")).toHaveText(code === codes[0] ? "Earned this week: PKR 5,000" : "Earned this week: PKR 0");
  }
  // Still fits a 1920×1080 office display with the extra line.
  const box = await podium.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(1080);
  for (const c of await cards.all()) {
    const b = await c.boundingBox();
    expect(b!.y + b!.height).toBeLessThanOrEqual(1080);
  }
  await expect(page.getByTestId("bonus-popup")).toHaveCount(0); // a data refresh never triggers a popup
});

test("when award data cannot be loaded the podium says unavailable instead of a fake zero", async ({ page }) => {
  await page.route("**/api/arena/awards**", (route) => route.fulfill({ status: 503, json: { ok: false, error: "Awards are unavailable right now." } }));
  await open(page);
  const first = page.getByTestId("top3-weekly").locator("li").first().getByTestId("earned-bonus");
  await expect(first).toHaveAttribute("data-state", "unavailable", { timeout: 15_000 });
  await expect(first).toHaveText("Bonus this week: unavailable");
  await expect(page.getByTestId("closer-rows").getByTestId("earned-bonus")).toHaveCount(0);
});
