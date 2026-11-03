import { test, expect } from "@playwright/test";

/**
 * Arena Cub end to end. The Live Arena checks use browser-side route interception only (server stream,
 * activity, config, awards): nothing is written to any database and no sale, award or spin is created.
 * The settings test does one real admin save and restores the previous value.
 */

import { adminPut, cub, cubClip, minsAgo, poses, rig, SHOTS, sse } from "./cub-helpers";

test.describe("Arena Cub on the Live Arena", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 }, contextOptions: { reducedMotion: "no-preference" } });
  // Each display load fetches real live data through the dev server; allow for slow first loads.
  test.describe.configure({ timeout: 180_000 });

  test("feeds once per genuine live sale; never for imports, old finds or repeated deliveries (incl. reconnects)", async ({ page }) => {
    const r = await rig(page);
    // Short reconnect delay: every reconnect redelivers the same events.
    await r.open({ lastSaleAt: minsAgo(3), retry: 1500 });
    await expect(cub(page)).toHaveAttribute("data-pose", "idle", { timeout: 15_000 });
    const sale = { caseId: `E2E-CUB-${Date.now()}`, userCode: "E2E-1", closerName: "Test Closer", validatedAt: new Date().toISOString(), source: "sse" };
    r.stream(
      sse("sale.validated", sale) +
        sse("sale.validated", sale) + // duplicate delivery
        sse("sale.validated", { ...sale, caseId: `${sale.caseId}-IMPORT`, source: "backfill" }) + // historical import
        sse("sale.validated", { ...sale, caseId: `${sale.caseId}-OLD`, source: "reconciliation", validatedAt: minsAgo(180) }), // late find
    );
    await expect(cub(page)).toHaveAttribute("data-pose", "feeding", { timeout: 10_000 });
    await expect(page.getByTestId("arena-cub-bubble")).toContainText(/Great work, Test!/, { timeout: 5000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/feeding-1920.png`, animations: "allow" });
    // The stream reconnects every ~1.5 s and redelivers the same events: no replay.
    await page.waitForTimeout(7000);
    expect((await poses(page)).filter((p) => p === "feeding")).toHaveLength(1);
    await expect(cub(page)).not.toHaveAttribute("data-pose", "feeding");
    // A second genuine sale feeds again.
    r.stream(sse("sale.validated", { ...sale, caseId: `${sale.caseId}-2`, closerName: "Second Agent", validatedAt: new Date().toISOString() }));
    await expect.poll(async () => (await poses(page)).filter((p) => p === "feeding").length, { timeout: 10_000 }).toBe(2);
  });

  test("mood comes from the shared last-sale time: idle → hungry → angry → sad → resting, sleeping off-hours", async ({ page }) => {
    test.setTimeout(120_000);
    const r = await rig(page);
    let hungryAt = ""; // the server's last-sale time stays the same across refreshes
    const cases: Array<[number, string]> = [
      [5, "idle"],
      [15.3, "hungry"], // just past the 15-minute reminder moment when the display first asks
      [31, "angry"],
      [45.5, "sad"],
      [90, "resting"],
    ];
    for (const [mins, mood] of cases) {
      await r.open({ saleMinsAgo: mins });
      await expect(cub(page)).toHaveAttribute("data-pose", mood, { timeout: 15_000 });
      if (mood === "hungry") {
        hungryAt = r.served()!;
        // Fresh reminder moment (15 min): one short performance with a bubble, then the quiet mood.
        await expect(cub(page)).toHaveAttribute("data-act", "reminder");
        await expect(page.getByTestId("arena-cub-bubble")).toContainText(/hungry|sale/i);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${SHOTS}/hungry-1920.png`, animations: "allow" });
      }
      if (mood !== "idle") await page.screenshot({ path: `${SHOTS}/mood-${mood}.png`, clip: await cubClip(page) });
    }
    // A refresh does not restart the count or replay the reminder already shown on this display.
    await r.open({ lastSaleAt: hungryAt });
    await expect(cub(page)).toHaveAttribute("data-pose", "hungry", { timeout: 15_000 });
    await page.waitForTimeout(1500);
    expect(await poses(page)).not.toContain("hungry:reminder");
    // Outside active days: asleep, never asking for sales.
    await r.open({ lastSaleAt: minsAgo(200), cub: { activeDays: [] } });
    await expect(cub(page)).toHaveAttribute("data-pose", "sleeping", { timeout: 15_000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/mood-sleeping.png`, clip: await cubClip(page) });
    expect((await poses(page)).some((p) => p.endsWith(":reminder"))).toBe(false);
  });

  test("bonus celebration uses the real award after its popup (highest tier: total + increase)", async ({ page }) => {
    test.setTimeout(90_000);
    let createdAt = "";
    await page.route("**/api/arena/awards**", async (route) => {
      try {
        const res = await route.fetch();
        const j = await res.json();
        if (createdAt)
          j.awards = [
            {
              id: `e2e-cub-award-${createdAt}`, programId: "e2e-p3", kind: "daily", agentId: "agt_E2E-CUB", userCode: "E2E-CUB", agentName: "Bonus Agent",
              periodKey: "D:e2e", n: 1, validatedAtAward: 3, amount: 3000, prizeLabel: "", programName: "Daily 3", salesRequired: 3, rewardType: "cash",
              currency: "PKR", announce: true, createdAt, upgrade: true, previousAmount: 2000, incrementAmount: 1000,
            },
          ];
        await route.fulfill({ status: 200, json: j });
      } catch {
        await route.continue().catch(() => {});
      }
    });
    const r = await rig(page);
    await r.open({ lastSaleAt: minsAgo(2) });
    await expect(cub(page)).toBeVisible({ timeout: 15_000 });
    createdAt = new Date(Date.now() + 1000).toISOString();
    await page.getByRole("button", { name: /refresh/i }).first().click();
    await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 15_000 });
    // The cub waits underneath while the popup is shown (the popup is above it)…
    expect(await poses(page)).not.toContain("bonus");
    await expect(cub(page)).toBeVisible();
    await expect(page.getByTestId("bonus-popup")).toHaveCount(0, { timeout: 40_000 });
    // …then celebrates with the award's own numbers.
    await expect(cub(page)).toHaveAttribute("data-pose", "bonus", { timeout: 5000 });
    const bubble = page.getByTestId("arena-cub-bubble");
    await expect(bubble).toContainText("Bonus upgraded!");
    await expect(bubble).toContainText("PKR 3,000 daily total (+PKR 1,000)");
    await expect(bubble).not.toContainText("5,000");
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}/bonus-1920.png`, animations: "allow" });
  });

  test("hidden when disabled or on a screen it is not shown on; reduced motion respected", async ({ page }) => {
    const r = await rig(page);
    await r.open({ cub: { screens: { daily: true, weekly: false, monthly: true, spin: false } } });
    await expect(cub(page)).toBeVisible({ timeout: 15_000 });
    const tabs = page.getByRole("tablist", { name: "Live Arena screen" });
    await tabs.getByRole("tab", { name: "Weekly Arena" }).click();
    await expect(cub(page)).toHaveCount(0);
    await tabs.getByRole("tab", { name: "Monthly Arena" }).click();
    await expect(cub(page)).toBeVisible({ timeout: 10_000 });
    await r.open({ cub: { enabled: false } });
    await page.waitForTimeout(2500);
    await expect(cub(page)).toHaveCount(0);
    await tabs.getByRole("tab", { name: "Daily Arena" }).click();
    await expect(cub(page)).toHaveCount(0);

    // Reduced motion (display preference) switches the cub to static poses, live.
    await r.open({});
    await expect(cub(page)).toHaveAttribute("data-motion", "full", { timeout: 15_000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(cub(page)).toHaveAttribute("data-motion", "reduced");
  });

  // Big, clearly visible, always fully inside the screen and below the header (no more hiding in a gap).
  const TARGET: Record<string, [number, number]> = { "1920x1080": [280, 340], "1600x900": [240, 300], "1366x768": [200, 260], "1280x720": [180, 230], "768x1024": [150, 340], "390x844": [100, 215] };
  for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [768, 1024], [390, 844]] as const) {
    test(`size and home at ${w}×${h}: big, sharp, fully visible, below the header`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: w, height: h });
      const r = await rig(page);
      for (const mode of ["daily", "weekly", "monthly"]) {
        await r.open({ lastSaleAt: minsAgo(2), mode });
        const tabs = page.getByRole("tablist", { name: "Live Arena screen" });
        const label = { daily: "Daily Arena", weekly: "Weekly Arena", monthly: "Monthly Arena" }[mode]!;
        if (await tabs.isVisible()) await tabs.getByRole("tab", { name: label }).click();
        else await page.getByRole("combobox").first().selectOption({ label });
        await expect(page.locator("[data-arena-mode]")).toHaveAttribute("data-arena-mode", mode);
        await expect(cub(page)).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(800);
        const res = await page.evaluate(() => {
          const root = document.querySelector('[data-testid="arena-cub-root"]') as HTMLElement;
          const b = root.getBoundingClientRect();
          const svg = root.querySelector("svg")!.getBoundingClientRect();
          const header = document.querySelector("header")!.getBoundingClientRect();
          const c = { x0: b.left + b.width * 0.12, x1: b.left + b.width * 0.84, y0: b.top + b.height * 0.27, y1: b.top + b.height * 0.99 };
          return { charH: Number(root.dataset.charHeight), c, headerBottom: header.bottom, vw: innerWidth, vh: innerHeight, aspect: svg.height / svg.width };
        });
        const [lo, hi] = TARGET[`${w}x${h}`];
        expect(res.charH, `height at ${w}×${h}`).toBeGreaterThanOrEqual(lo);
        expect(res.charH).toBeLessThanOrEqual(hi);
        expect(res.c.x0).toBeGreaterThanOrEqual(0);
        expect(res.c.x1).toBeLessThanOrEqual(res.vw);
        expect(res.c.y1).toBeLessThanOrEqual(res.vh);
        expect(res.c.y0).toBeGreaterThanOrEqual(res.headerBottom - 1); // never over the navigation
        expect(Math.abs(res.aspect - 310 / 280)).toBeLessThan(0.01); // never stretched
        await page.screenshot({ path: `${SHOTS}/v2-size-${w}x${h}-${mode}.png` });
      }
    });
  }
});

test("admin: settings persist in PostgreSQL, invalid timing is refused, open screens update live (size too)", async ({ browser, context, baseURL }) => {
  test.setTimeout(120_000);
  const before = (await (await context.request.get("/api/arena/config")).json()).values.arenaCub;
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 } });
  const screen = await ctx.newPage();
  try {
    const ok = await adminPut(context, baseURL!, { arenaCub: { ...before, allowOnLiveArena: true, enabled: true, sizePreset: "large", screens: { ...before.screens, daily: true } } });
    expect(ok.status(), await ok.text()).toBe(200);
    await screen.goto("/");
    await expect(screen.locator("[data-arena-mode]")).toBeVisible({ timeout: 60_000 });
    await expect(cub(screen)).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByTestId("arena-cub-root")).toHaveAttribute("data-char-height", "310");

    const bad = await adminPut(context, baseURL!, { arenaCub: { ...before, hungerMin: 40, angryMin: 30 } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toMatch(/hungry time must come before/);
    const unknown = await adminPut(context, baseURL!, { arenaCub: { ...before, hackerField: true } });
    expect(unknown.status()).toBe(400);

    // Size changes reach the open screen live: Extra Large, then Custom.
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, allowOnLiveArena: true, sizePreset: "xl" } })).status()).toBe(200);
    await expect(screen.getByTestId("arena-cub-root")).toHaveAttribute("data-char-height", "400", { timeout: 15_000 });
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, allowOnLiveArena: true, sizePreset: "custom", size: 360 } })).status()).toBe(200);
    await expect(screen.getByTestId("arena-cub-root")).toHaveAttribute("data-char-height", "360", { timeout: 15_000 });
    await screen.screenshot({ path: `${SHOTS}/v2-custom-360.png` });

    const off = await adminPut(context, baseURL!, { arenaCub: { ...before, allowOnLiveArena: true, enabled: false } });
    expect(off.status()).toBe(200);
    expect((await (await context.request.get("/api/arena/config")).json()).values.arenaCub.enabled).toBe(false); // stored
    await expect(cub(screen)).toHaveCount(0, { timeout: 15_000 }); // live, no refresh
  } finally {
    await adminPut(context, baseURL!, { arenaCub: before });
    await ctx.close();
  }
});
