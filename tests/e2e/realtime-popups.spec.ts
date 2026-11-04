import { test, expect } from "@playwright/test";
import { cub, minsAgo, rig, sse } from "./cub-helpers";

/**
 * Browser side of real-time delivery: a sale and its bonus arrive on the Live Arena stream (browser-side
 * interception: nothing is written to any database). Both popups must appear within seconds, the cub must
 * not hold them back, a reconnect must not replay them, and the timeline must show every stage.
 */
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 }, contextOptions: { reducedMotion: "no-preference" } });
test.describe.configure({ timeout: 180_000 });

test("sale + bonus popups appear within seconds of arriving, with the cub on screen, and never replay", async ({ page }) => {
  // Count popup appearances (a replay would show the bonus popup again).
  await page.addInitScript(() => {
    const w = window as unknown as { __bonusShows: number; __saleShows: number };
    w.__bonusShows = 0;
    w.__saleShows = 0;
    let b = false;
    let s = false;
    setInterval(() => {
      const nb = !!document.querySelector('[data-testid="bonus-popup"]');
      const ns = document.body.innerText.includes("SALE VALIDATED!");
      if (nb && !b) w.__bonusShows++;
      if (ns && !s) w.__saleShows++;
      b = nb;
      s = ns;
    }, 50);
  });
  const r = await rig(page);
  await r.open({ lastSaleAt: minsAgo(20), retry: 1500 }); // the cub is hungry and about to remind: it must not delay popups
  await expect(cub(page)).toBeVisible({ timeout: 15_000 });

  const now = Date.now();
  const caseId = `E2E-RT-${now}`;
  const iso = (ms: number) => new Date(ms).toISOString();
  const award = {
    id: `e2e-rt-award-${now}`, programId: "e2e-p2", kind: "daily", agentId: "agt_E2E-RT", userCode: "E2E-RT", agentName: "Realtime Agent", periodKey: "D:e2e", n: 1,
    validatedAtAward: 2, amount: 2000, prizeLabel: "", programName: "Daily 2", salesRequired: 2, rewardType: "cash", currency: "PKR", announce: true, createdAt: iso(now + 400),
    upgrade: false, previousAmount: 0, incrementAmount: 2000,
  };
  r.stream(
    sse("sale.validated", { caseId, userCode: "E2E-RT", closerName: "Realtime Agent", validatedAt: iso(now - 3000), source: "sse", firstSeenAt: iso(now - 200), storedAt: iso(now - 100), broadcastAt: iso(now) }) +
      sse("rewards.award.created", { award, validatedAt: iso(now - 3000), source: "sse", firstSeenAt: iso(now - 200), broadcastAt: iso(now + 450) }),
    4, // redelivered on each of the next reconnects: must never replay a popup
  );
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("bonus-popup")).toContainText("2,000");
  await page.screenshot({ path: "playwright-report/arena-cub/realtime-bonus-popup.png" });

  // Timeline measured in this browser: arrival → popup within seconds for both.
  const log = await page.evaluate(() => (window as unknown as { __arenaLatency: Array<{ kind: string; key: string; stages: Record<string, number | null> }> }).__arenaLatency);
  const sale = log.find((x) => x.kind === "sale" && x.key === caseId)!;
  const bonus = log.find((x) => x.kind === "award" && x.key === award.id)!;
  expect(bonus.stages.browserToPopup).not.toBeNull();
  expect(bonus.stages.browserToPopup!).toBeLessThan(3000);
  expect(sale.stages.storedToBroadcast).toBe(100);
  console.log("TIMELINE", JSON.stringify({ sale: sale.stages, bonus: bonus.stages }));
  // The sale toast follows once the bonus popup closes (they never overlap); still well within seconds.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saleShows: number }).__saleShows), { timeout: 20_000 }).toBe(1);
  const saleShown = await page.evaluate((k) => (window as unknown as { __arenaLatency: Array<{ kind: string; key: string; stages: Record<string, number | null> }> }).__arenaLatency.find((x) => x.kind === "sale" && x.key === k)!.stages.browserToPopup, caseId);
  expect(saleShown).not.toBeNull();
  expect(saleShown!).toBeLessThan(15_000);

  // The stream reconnects several times and redelivers both events: no replayed popup.
  await page.waitForTimeout(8000);
  expect(await page.evaluate(() => (window as unknown as { __bonusShows: number }).__bonusShows)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __saleShows: number }).__saleShows)).toBe(1);
});
