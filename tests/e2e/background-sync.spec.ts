import { test, expect, type Page, type Route } from "@playwright/test";
import { cub, minsAgo, rig, sse } from "./cub-helpers";

/**
 * Background sync (no page reloads) next to the live stream. Browser-side interception only: the sync
 * check and the stream are answered by the test, nothing is written to any database.
 */
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 }, contextOptions: { reducedMotion: "no-preference" } });
test.describe.configure({ timeout: 240_000 });

const FAST = { liveSyncSeconds: 10 }; // the smallest allowed interval keeps the tests short

interface SyncCtl {
  hits: number;
  recent: Array<Record<string, unknown>> | null;
  fp: Record<string, unknown>;
}
/** The display's /api/arena/sync check, answered from the real server with test overrides. */
async function syncRoute(page: Page): Promise<SyncCtl> {
  const ctl: SyncCtl = { hits: 0, recent: null, fp: {} };
  await page.route("**/api/arena/sync", async (route: Route) => {
    ctl.hits++;
    try {
      const j = await (await route.fetch()).json();
      await route.fulfill({ json: { ...j, fp: { ...j.fp, ...ctl.fp }, recentSales: ctl.recent ?? j.recentSales } });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  return ctl;
}
/** Counts popups and full page loads (a reload would reset window state and add a navigation). */
async function counters(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __saleShows: number; __bonusShows: number; __loads: number };
    w.__saleShows = 0;
    w.__bonusShows = 0;
    try {
      const n = Number(sessionStorage.getItem("e2e-loads") || 0) + 1;
      sessionStorage.setItem("e2e-loads", String(n));
      w.__loads = n;
    } catch {
      w.__loads = -1;
    }
    let s = false;
    let b = false;
    setInterval(() => {
      const ns = document.body?.innerText.includes("SALE VALIDATED!") ?? false;
      const nb = !!document.querySelector('[data-testid="bonus-popup"]');
      if (ns && !s) w.__saleShows++;
      if (nb && !b) w.__bonusShows++;
      s = ns;
      b = nb;
    }, 50);
  });
}
const get = (page: Page, k: "__saleShows" | "__bonusShows" | "__loads") => page.evaluate((key) => (window as unknown as Record<string, number>)[key], k);
const latency = (page: Page) => page.evaluate(() => (window as unknown as { __arenaLatency: Array<{ kind: string; key: string; via?: string; stages: Record<string, number | null> }> }).__arenaLatency ?? []);
const recentSale = (caseId: string, storedAt = new Date().toISOString()) => ({ caseId, userCode: "E2E-BG", closerName: "Background Agent", validatedAt: minsAgo(3), firstSeenAt: storedAt, source: "reconciliation" });

test("interrupted live stream: a missed sale still pops up within one sync interval, once, with no page reload; refresh never replays it", async ({ page }) => {
  await counters(page);
  const ctl = await syncRoute(page);
  const r = await rig(page);
  await r.open({ lastSaleAt: minsAgo(2), values: FAST });
  await expect(cub(page)).toBeVisible({ timeout: 15_000 });
  const marker = await page.evaluate(() => ((window as unknown as { __m: number }).__m = Math.random()));

  // Break the live stream for good (every reconnect is refused), like a proxy dropping it.
  await page.unroute("**/api/arena/stream");
  await page.route("**/api/arena/stream", (route) => route.abort());
  // The first check is scheduled before the Admin setting arrives (default 15 s ± 10 %), later ones every 10 s.
  await expect.poll(() => ctl.hits, { timeout: 25_000 }).toBeGreaterThanOrEqual(1); // baseline check done

  const caseId = `E2E-BG-${Date.now()}`;
  ctl.recent = [recentSale(caseId)];
  const t0 = Date.now();
  await expect.poll(() => get(page, "__saleShows"), { timeout: 15_000, intervals: [200] }).toBe(1);
  const waited = Date.now() - t0;
  console.log("RECOVERED_SALE_POPUP_AFTER_MS", waited);
  expect(waited).toBeLessThan(13_000); // ≤ one 10 s interval (+ jitter)
  const t = (await latency(page)).find((x) => x.kind === "sale" && x.key === caseId)!;
  expect(t.via).toBe("sync");
  expect(t.stages.sourceToServer).toBeGreaterThan(150_000); // the real (slow) discovery is recorded, not "instant"

  // It stays one popup: more checks, and the same sale arriving late on a recovered stream.
  await page.unroute("**/api/arena/stream");
  await page.route("**/api/arena/stream", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `retry: 1000\n\nevent: ready\ndata: {}\n\n${sse("sale.validated", { caseId, userCode: "E2E-BG", closerName: "Background Agent", validatedAt: minsAgo(3), source: "reconciliation" })}` }),
  );
  await page.waitForTimeout(22_000);
  expect(await get(page, "__saleShows")).toBe(1);
  expect(await get(page, "__loads")).toBe(1); // never reloaded
  expect(await page.evaluate(() => (window as unknown as { __m: number }).__m)).toBe(marker);
  await expect(cub(page)).toBeVisible();

  // Refresh: the sale was stored before this page opened, so it is history (no replay).
  await page.unroute("**/api/arena/stream");
  const r2 = await rig(page);
  await r2.open({ lastSaleAt: minsAgo(2), values: FAST });
  expect(await get(page, "__loads")).toBe(2);
  const hits = ctl.hits;
  await expect.poll(() => ctl.hits, { timeout: 30_000 }).toBeGreaterThanOrEqual(hits + 2);
  expect(await get(page, "__saleShows")).toBe(0);
});

test("healthy stream: sale and bonus popups appear at once even with a 120 s sync interval; duplicates create one celebration", async ({ page }) => {
  await counters(page);
  const ctl = await syncRoute(page);
  const r = await rig(page);
  await r.open({ lastSaleAt: minsAgo(2), values: { liveSyncSeconds: 120 } });
  await expect(cub(page)).toBeVisible({ timeout: 15_000 });
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const caseId = `E2E-IM-${now}`;
  const award = {
    id: `e2e-im-award-${now}`, programId: "e2e-p3", kind: "daily", agentId: "agt_E2E-IM", userCode: "E2E-IM", agentName: "Instant Agent", periodKey: "D:e2e", n: 1,
    validatedAtAward: 3, amount: 3000, prizeLabel: "", programName: "Daily 3", salesRequired: 3, rewardType: "cash", currency: "PKR", announce: true, createdAt: iso(now),
    upgrade: true, previousAmount: 2000, incrementAmount: 1000,
  };
  const sale = sse("sale.validated", { caseId, userCode: "E2E-IM", closerName: "Instant Agent", validatedAt: iso(now - 2000), source: "sse", firstSeenAt: iso(now - 300), storedAt: iso(now - 200), broadcastAt: iso(now - 100) });
  const bonus = sse("rewards.award.created", { award, validatedAt: iso(now - 2000), source: "sse", firstSeenAt: iso(now - 300), broadcastAt: iso(now) });
  r.stream(sale + sale + bonus + bonus, 3); // each event twice, and redelivered on reconnects
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 5_000 });
  // Highest tier: the final effective bonus, with the increase; never an additive 5,000.
  await expect(page.getByTestId("bonus-popup")).toContainText("3,000");
  await expect(page.getByTestId("bonus-popup")).not.toContainText("5,000");
  await page.screenshot({ path: "playwright-report/arena-cub/bg-sync-bonus-upgrade.png" });
  const log = await latency(page);
  const b = log.find((x) => x.kind === "award" && x.key === award.id)!;
  expect(b.stages.browserToPopup!).toBeLessThan(2000);
  await expect.poll(() => get(page, "__saleShows"), { timeout: 25_000 }).toBe(1); // after the bonus popup
  // A sync check returning the same sale later must not repeat it either.
  ctl.recent = [recentSale(caseId)];
  await page.waitForTimeout(6000);
  expect(await get(page, "__saleShows")).toBe(1);
  expect(await get(page, "__bonusShows")).toBe(1);
});

test("idle displays stay light: one tiny check per interval, re-fetch only what changed, cub undisturbed", async ({ browser }) => {
  // Three displays at once (office TVs / laptops).
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1600, height: 900 }, reducedMotion: "no-preference" });
  const pages = await Promise.all([0, 1, 2].map(() => ctx.newPage()));
  const ctls: SyncCtl[] = [];
  const reqs: string[][] = [];
  for (const p of pages) {
    ctls.push(await syncRoute(p));
    const list: string[] = [];
    reqs.push(list);
    p.on("request", (q) => {
      const u = new URL(q.url());
      if (u.pathname.startsWith("/api/")) list.push(u.pathname);
    });
  }
  for (const p of pages) await (await rig(p)).open({ lastSaleAt: minsAgo(2), values: FAST, cub: { position: "bottom-left" } });
  await Promise.all(pages.map((p) => expect(cub(p)).toBeVisible({ timeout: 20_000 })));
  // Mark the cub's DOM node: a remount would replace it.
  for (const p of pages) await p.evaluate(() => ((document.querySelector('[data-testid="arena-cub-root"]') as HTMLElement).dataset.e2eMark = "1"));
  const box0 = await pages[0].getByTestId("arena-cub-root").boundingBox();

  for (const l of reqs) l.length = 0;
  const hits0 = ctls.map((c) => c.hits);
  await pages[0].waitForTimeout(33_000);
  const perDisplay = ctls.map((c, i) => c.hits - hits0[i]);
  console.log("SYNC_CHECKS_PER_DISPLAY_33S", perDisplay, "OTHER_API", reqs.map((l) => l.filter((x) => !x.endsWith("/sync") && !x.includes("/cub"))));
  for (const n of perDisplay) {
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4);
  }
  // Nothing changed → no stats, awards or config re-fetch (the full refresh runs at most every 3 minutes).
  for (const l of reqs) expect(l.filter((x) => /\/api\/arena\/(summary|closers|recent-sales|awards|config|programs|catalog)/.test(x))).toEqual([]);

  // An awards change → only the small awards read; a sales change → one stats refresh. Never a reload.
  ctls.forEach((c) => (c.fp = { awards: `changed-${Date.now()}` }));
  await expect.poll(() => reqs[0].filter((x) => x === "/api/arena/awards").length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  expect(reqs[0].filter((x) => x.includes("/summary"))).toEqual([]);
  ctls.forEach((c) => (c.fp = { ...c.fp, sales: `changed-${Date.now()}` }));
  await expect.poll(() => reqs[0].filter((x) => x.includes("/api/arena/summary")).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

  // The cub was never remounted, moved home or hidden by any of it.
  for (const p of pages) {
    await expect(p.locator('[data-testid="arena-cub-root"][data-e2e-mark="1"]')).toHaveCount(1);
    await expect(cub(p)).toBeVisible();
  }
  const box1 = await pages[0].getByTestId("arena-cub-root").boundingBox();
  expect(Math.abs(box1!.x - box0!.x)).toBeLessThan(2);
  expect(box1!.x).toBeLessThan(800); // still bottom-left
  await ctx.close();
});

test("Admin: background checks refresh Award History and keep an unsaved program form", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ storageState: "tests/e2e/.auth/admin.json", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // Shorter interval for this tab only (the global setting stays as it is).
  await page.route("**/api/admin/arena-config", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const j = await (await route.fetch()).json();
    if (j?.data?.values) j.data.values.liveSyncSeconds = 10;
    else if (j?.values) j.values.liveSyncSeconds = 10;
    await route.fulfill({ json: j });
  });
  const ctl = await syncRoute(page);
  const awardLoads: number[] = [];
  const programLoads: number[] = [];
  page.on("request", (q) => {
    const u = new URL(q.url());
    if (q.method() === "GET" && u.pathname === "/api/admin/awards") awardLoads.push(Date.now());
    if (q.method() === "GET" && u.pathname === "/api/admin/programs") programLoads.push(Date.now());
  });
  await page.goto(`${baseURL}/admin/programs`);
  await page.getByRole("tab", { name: "Daily Rewards" }).click();
  await expect(page.getByTestId("add-program").first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("add-program").first().click();
  const name = page.getByTestId("program-editor").getByTestId("pe-name");
  await name.fill("Unsaved draft name 123");
  await expect.poll(() => ctl.hits, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  const p0 = programLoads.length;
  ctl.fp = { programs: `p-${Date.now()}`, awards: `a-${Date.now()}` };
  await expect.poll(() => programLoads.length, { timeout: 15_000 }).toBeGreaterThan(p0); // the list reloaded…
  await expect(name).toHaveValue("Unsaved draft name 123"); // …the open form kept its text
  await expect(name).toBeVisible();

  // Award History reloads when the awards change, without any live event (the stream missed it).
  const h0 = ctl.hits;
  await page.goto(`${baseURL}/admin/programs`);
  await page.getByRole("tab", { name: "Award History" }).click();
  await expect(page.getByTestId("award-history")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => ctl.hits, { timeout: 20_000 }).toBeGreaterThan(h0); // new page: baseline check done
  await page.waitForTimeout(500);
  const a0 = awardLoads.length;
  ctl.fp = { ...ctl.fp, awards: `a2-${Date.now()}` };
  await expect.poll(() => awardLoads.length, { timeout: 15_000 }).toBeGreaterThan(a0);
  await ctx.close();
});

for (const vp of [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`layout ${vp.width}×${vp.height}: Live Arena intact while syncing in the background`, async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: vp, reducedMotion: "no-preference" });
    const page = await ctx.newPage();
    const ctl = await syncRoute(page);
    await (await rig(page)).open({ lastSaleAt: minsAgo(2), values: FAST });
    await expect.poll(() => ctl.hits, { timeout: 25_000 }).toBeGreaterThanOrEqual(1);
    await expect(page.locator("header").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `playwright-report/arena-cub/bg-sync-${vp.width}x${vp.height}.png` });
    await ctx.close();
  });
}
