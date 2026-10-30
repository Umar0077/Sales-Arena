import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

/**
 * One admin change → every Live Arena display switches mode, no refresh, no admin login on displays.
 * Displays are separate browser contexts WITHOUT the admin session (like office laptops).
 */

const csrfFor = (t: string) => createHash("sha256").update(`csrf:${t}`).digest("base64url");

async function setMode(admin: BrowserContext, baseURL: string, mode: string) {
  const cookie = (await admin.cookies(baseURL)).find((c) => c.name.endsWith("sa_admin"))!;
  const res = await admin.request.put("/api/admin/display-settings", {
    headers: { "x-csrf-token": csrfFor(cookie.value), Origin: new URL(baseURL).origin, "content-type": "application/json" },
    data: { performanceMode: mode },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).revision as number;
}

async function openDisplay(browser: Browser, legacyQuality?: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } }); // no admin login
  if (legacyQuality)
    await ctx.addInitScript((q: string) => {
      try {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem("sales-arena:settings", JSON.stringify({ state: { quality: q }, version: 5 }));
          sessionStorage.setItem("seeded", "1");
        }
      } catch {}
    }, legacyQuality);
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 60_000 });
  return { ctx, page };
}

const perfAttr = (p: Page) => p.evaluate(() => document.documentElement.dataset.perfMode);
const savedQuality = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem("sales-arena:settings") || "{}").state?.quality);

test("Tests A–D: six displays follow the admin's global mode live; legacy prefs, new devices and reconnects included", async ({ browser, context, baseURL }) => {
  test.setTimeout(240_000);
  await setMode(context, baseURL!, "high");

  // Test A + C: six "laptops", half with an old High Quality preference in localStorage.
  const displays = [];
  for (let i = 0; i < 6; i++) displays.push(await openDisplay(browser, i % 2 ? "high" : undefined));
  for (const d of displays) await expect.poll(() => perfAttr(d.page)).toBe("high");

  await setMode(context, baseURL!, "performance");
  for (const d of displays) {
    await expect.poll(() => perfAttr(d.page), { timeout: 10_000 }).toBe("performance"); // no refresh
    expect(await savedQuality(d.page)).toBe("performance"); // old local value replaced
  }

  // Test D: one display goes offline, misses a change, and catches up on reconnect.
  const offline = displays[0];
  await offline.ctx.setOffline(true);
  await setMode(context, baseURL!, "high");
  for (const d of displays.slice(1)) await expect.poll(() => perfAttr(d.page), { timeout: 10_000 }).toBe("high");
  // Note: Playwright's offline mode does not cut an already-open stream, so this display may get
  // the change anyway; what matters is that it is correct after reconnecting.
  await offline.ctx.setOffline(false);
  await expect.poll(() => perfAttr(offline.page), { timeout: 45_000 }).toBe("high");

  // Test B: a brand-new device (no local settings) starts with the saved global mode.
  await setMode(context, baseURL!, "performance");
  const fresh = await openDisplay(browser);
  expect(await perfAttr(fresh.page)).toBe("performance");

  // Only ONE live stream per display (changing mode never opens more).
  const streams = await displays[1].page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/arena/stream")).length);
  expect(streams).toBeLessThanOrEqual(1);

  for (const d of [...displays, fresh]) await d.ctx.close();
  await setMode(context, baseURL!, "auto"); // leave dev back on the default
});
