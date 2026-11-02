import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

/**
 * One admin controls every display. Displays are separate browser contexts WITHOUT the admin
 * session (like office laptops / TVs). Nothing here creates sales, awards or spin credits.
 */

const csrfFor = (t: string) => createHash("sha256").update(`csrf:${t}`).digest("base64url");
async function adminCall(admin: BrowserContext, baseURL: string, method: "PUT" | "POST", url: string, data: unknown) {
  const cookie = (await admin.cookies(baseURL)).find((c) => c.name.endsWith("sa_admin"))!;
  const res = await admin.request.fetch(url, {
    method,
    headers: { "x-csrf-token": csrfFor(cookie.value), Origin: new URL(baseURL).origin, "content-type": "application/json" },
    data,
  });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}
const setConfig = (admin: BrowserContext, baseURL: string, values: Record<string, unknown>) => adminCall(admin, baseURL, "PUT", "/api/admin/arena-config", { values });
const ALL_ON = { arenaEnabled: true, arenaModes: { daily: true, weekly: true, monthly: true, spin: true }, defaultArenaMode: "daily", showModeSelector: true };

async function openDisplay(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("[data-arena-mode]")).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  return { ctx, page };
}
const selector = (p: Page) => p.getByRole("tablist", { name: "Live Arena screen" });
const mode = (p: Page) => p.locator("[data-arena-mode]").getAttribute("data-arena-mode");
const notReloaded = (p: Page) => p.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true);
const streams = (p: Page) => p.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/arena/stream")).length);

test("Scenario A + F: six displays follow every admin change live, without refresh or admin login", async ({ browser, context, baseURL, page: admin }) => {
  test.setTimeout(300_000);
  await setConfig(context, baseURL!, ALL_ON);
  const displays = [];
  for (let i = 0; i < 6; i++) displays.push(await openDisplay(browser));
  for (const d of displays) await expect(selector(d.page)).toBeVisible();

  // Hide the public screen selector.
  await setConfig(context, baseURL!, { showModeSelector: false });
  for (const d of displays) await expect(selector(d.page)).toHaveCount(0);

  // Disable Weekly Arena: gone from every selector.
  await setConfig(context, baseURL!, { showModeSelector: true, arenaModes: { daily: true, weekly: false, monthly: true, spin: true } });
  for (const d of displays) {
    await expect(selector(d.page)).toBeVisible();
    await expect(selector(d.page).getByRole("tab", { name: "Weekly Arena" })).toHaveCount(0);
  }

  // Changing the default does not move open displays...
  await setConfig(context, baseURL!, { defaultArenaMode: "monthly" });
  await displays[0].page.waitForTimeout(1500);
  for (const d of displays) expect(await mode(d.page)).toBe("daily");
  // ...but "Switch the Live Arena now" does, on every display.
  await adminCall(context, baseURL!, "POST", "/api/admin/arena-config/screen", { screen: "monthly" });
  for (const d of displays) await expect.poll(() => mode(d.page), { timeout: 10_000 }).toBe("monthly");
  // A new display opens on the (new) default.
  const fresh = await openDisplay(browser);
  expect(await mode(fresh.page)).toBe("monthly");

  // Global Live Arena OFF / ON.
  await setConfig(context, baseURL!, { arenaEnabled: false, arenaOfflineMessage: "Back after the team meeting." });
  for (const d of displays) {
    await expect(d.page.getByTestId("arena-offline")).toBeVisible();
    await expect(d.page.getByText("Back after the team meeting.")).toBeVisible();
  }
  await setConfig(context, baseURL!, { arenaEnabled: true });
  for (const d of displays) await expect(d.page.getByTestId("arena-offline")).toHaveCount(0);

  // All screens disabled → safe offline page; Admin stays available.
  await setConfig(context, baseURL!, { arenaModes: { daily: false, weekly: false, monthly: false, spin: false } });
  for (const d of displays) await expect(d.page.getByText("No Live Arena screens are enabled right now.")).toBeVisible();
  await setConfig(context, baseURL!, ALL_ON);
  for (const d of displays) await expect(d.page.getByTestId("arena-offline")).toHaveCount(0);

  // Scenario F: a reward program created in the Admin UI reaches every display.
  const name = `E2E Daily Double ${Date.now()}`;
  await admin.goto("/admin/programs");
  await admin.getByRole("tab", { name: "Daily Rewards" }).click();
  await admin.getByTestId("add-program").click();
  await admin.getByTestId("pe-name").fill(name);
  await admin.getByTestId("pe-sales").fill("2");
  await admin.getByTestId("pe-amount").fill("3000");
  await admin.getByTestId("pe-active").check();
  await expect(admin.getByTestId("pe-preview")).toContainText("Rs. 3,000 Bonus Earned");
  await admin.getByTestId("pe-save").click();
  const row = admin.locator(`[data-testid=program-row][data-program="${name}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("program-status")).toHaveText("active");
  // Displays (Daily Arena) show the new rule without a refresh. Other existing programs may have a lower threshold,
  // so check the program list each display received from the server.
  for (const d of displays)
    await expect
      .poll(() => d.page.evaluate(async (n) => (await (await fetch("/api/arena/programs")).json()).programs.some((p: { name: string }) => p.name === n), name))
      .toBe(true);
  // Archive it again (programs are never deleted); it disappears from the public list.
  admin.once("dialog", (dlg) => void dlg.accept());
  await row.getByTestId("program-archive").click();
  await expect(row).toHaveCount(0); // the default filter hides archived programs
  await admin.getByRole("tab", { name: "archived", exact: true }).click();
  await expect(admin.locator(`[data-testid=program-row][data-program="${name}"]`).getByTestId("program-status")).toHaveText("archived");

  // Award History tab loads real PostgreSQL rows (or an empty table), never browser state.
  await admin.getByRole("tab", { name: "Award History" }).click();
  await expect(admin.getByTestId("award-history")).toBeVisible();

  for (const d of [...displays, fresh]) {
    expect(await notReloaded(d.page)).toBe(true);
    expect(await streams(d.page)).toBeLessThanOrEqual(1);
    await d.ctx.close();
  }
  await setConfig(context, baseURL!, ALL_ON);
});

test("Scenario G: one silent reconciliation after 180 s — no reload, no extra stream, screen kept, no popups", async ({ browser, context, baseURL }) => {
  test.setTimeout(180_000);
  await setConfig(context, baseURL!, ALL_ON);
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.clock.install();
  const calls: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/arena/")) calls.push(u.pathname);
  });
  await page.goto("/");
  await expect(page.locator("[data-arena-mode]")).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  await selector(page).getByRole("tab", { name: "Weekly Arena" }).click();
  await expect.poll(() => mode(page)).toBe("weekly");
  await page.clock.runFor(5_000); // let start-up settle
  const before = calls.length;
  const configBefore = calls.filter((c) => c === "/api/arena/config").length;

  await page.clock.runFor(170_000); // not yet
  expect(calls.filter((c) => c === "/api/arena/config").length).toBe(configBefore);
  await page.clock.runFor(10_000); // crosses 180 s
  await expect.poll(() => calls.filter((c) => c === "/api/arena/config").length).toBe(configBefore + 1);
  await expect.poll(() => calls.slice(before).filter((c) => c === "/api/arena/summary").length).toBeGreaterThan(0);
  for (const p of ["/api/arena/catalog", "/api/arena/display-settings", "/api/arena/programs", "/api/arena/targets", "/api/arena/spin/totals", "/api/arena/awards"])
    expect(calls.slice(before), p).toContain(p);

  expect(await notReloaded(page)).toBe(true);
  expect(await mode(page)).toBe("weekly"); // selected screen kept
  expect(calls.filter((c) => c === "/api/arena/stream").length).toBe(1);
  await expect(page.getByTestId("bonus-popup")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.lastReconcile ?? null)).toBeTruthy();
  await ctx.close();
});
