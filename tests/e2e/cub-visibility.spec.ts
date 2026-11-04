import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { adminPut, cub } from "./cub-helpers";

/**
 * Arena Cub public visibility, end to end through the real Admin UI (no request interception):
 * Admin and Live Arena in the SAME browser (two tabs) and on a separate display browser.
 * The permission is restored afterwards. No sale, award or spin is created.
 */

const WIDE = { activeStart: "00:00", activeEnd: "23:59", activeDays: [0, 1, 2, 3, 4, 5, 6], introFrequency: "off", hunger: false };

async function arenaTab(ctx: BrowserContext): Promise<Page> {
  const p = await ctx.newPage();
  await p.goto("/");
  await expect(p.locator("[data-arena-mode]")).toBeVisible({ timeout: 90_000 });
  await p.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  return p;
}
const notReloaded = (p: Page) => p.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true);

test.describe("Arena Cub public visibility", () => {
  test.use({ viewport: { width: 1600, height: 900 } });
  test.describe.configure({ timeout: 240_000 });
  let before: Record<string, unknown>;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    before = (await (await ctx.request.get("/api/arena/config")).json()).values.arenaCub;
    await ctx.close();
  });
  test.afterAll(async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    await adminPut(ctx, baseURL!, { arenaCub: before });
    await ctx.close();
  });

  test("Admin ON → cub appears without refresh (same-browser tab and separate display); OFF → disappears; survives other setting saves and refresh", async ({ browser, context, baseURL }) => {
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, ...WIDE, allowOnLiveArena: false, enabled: true } })).status()).toBe(200);

    // A Live Arena tab in the admin's own browser, and an office display (separate browser, no admin session).
    const sameBrowser = await arenaTab(context);
    const officeCtx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1600, height: 900 } });
    const office = await arenaTab(officeCtx);
    await expect(cub(sameBrowser)).toHaveCount(0);
    await expect(cub(office)).toHaveCount(0);

    // Enable from the real Admin UI.
    const admin = await context.newPage();
    await admin.goto("/admin/celebrations");
    await expect(admin.getByTestId("cub-live-status")).toHaveText("Disabled", { timeout: 30_000 });
    await admin.getByTestId("cub-allow-live").click();
    await admin.getByTestId("cub-allow-confirm-yes").click();
    await expect(admin.getByTestId("cub-live-status")).toHaveText("Enabled", { timeout: 10_000 });
    expect((await (await context.request.get("/api/arena/config")).json()).values.arenaCub.allowOnLiveArena).toBe(true); // saved in PostgreSQL

    for (const p of [sameBrowser, office]) await expect(cub(p)).toBeVisible({ timeout: 15_000 });
    await sameBrowser.waitForTimeout(4000); // stays visible (no late overwrite by a cached copy)
    for (const p of [sameBrowser, office]) {
      await expect(cub(p)).toBeVisible();
      expect(await notReloaded(p)).toBe(true);
    }

    // Changing another cub setting in Admin keeps the permission ON (never saved back as OFF).
    await admin.getByRole("switch", { name: "Speech bubbles" }).click();
    await admin.waitForTimeout(2500);
    expect((await (await context.request.get("/api/arena/config")).json()).values.arenaCub.allowOnLiveArena).toBe(true);
    await expect(admin.getByTestId("cub-live-status")).toHaveText("Enabled");
    for (const p of [sameBrowser, office]) await expect(cub(p)).toBeVisible();

    // Weekly and Monthly screens show it too; outside active hours it is still visible (sleeping).
    const tabs = office.getByRole("tablist", { name: "Live Arena screen" });
    for (const name of ["Weekly Arena", "Monthly Arena", "Daily Arena"]) {
      await tabs.getByRole("tab", { name }).click();
      await expect(cub(office)).toBeVisible({ timeout: 10_000 });
    }
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, ...WIDE, activeDays: [], allowOnLiveArena: true, enabled: true } })).status()).toBe(200);
    await expect(cub(office)).toHaveAttribute("data-pose", "sleeping", { timeout: 20_000 });
    await expect(cub(office)).toBeVisible();

    // A refresh keeps the authoritative state (ON).
    await office.reload();
    await expect(cub(office)).toBeVisible({ timeout: 60_000 });

    // Disable from the Admin UI: gone everywhere at once, no refresh.
    await admin.reload();
    await expect(admin.getByTestId("cub-live-status")).toHaveText("Enabled", { timeout: 30_000 });
    await admin.getByTestId("cub-hide-live").click();
    await expect(admin.getByTestId("cub-live-status")).toHaveText("Disabled", { timeout: 10_000 });
    for (const p of [sameBrowser, office]) await expect(cub(p)).toHaveCount(0, { timeout: 15_000 });
    await office.reload();
    await expect(office.locator("[data-arena-mode]")).toBeVisible({ timeout: 60_000 });
    await office.waitForTimeout(3000);
    await expect(cub(office)).toHaveCount(0);
    await officeCtx.close();
  });
});
