import { test, expect, type BrowserContext } from "@playwright/test";
import { createHash } from "node:crypto";

/**
 * The public Live Arena shows NO permanent bonus-tier cards (Daily / Weekly / Monthly), while the
 * programs keep running in PostgreSQL (earned bonuses are announced by popup only). Programs are
 * created through the Admin API on the DEV database and archived again; no sales or awards are created.
 */
const csrfFor = (t: string) => createHash("sha256").update(`csrf:${t}`).digest("base64url");
async function admin(ctx: BrowserContext, baseURL: string) {
  const cookie = (await ctx.cookies(baseURL)).find((c) => c.name.endsWith("sa_admin"))!;
  const headers = { "x-csrf-token": csrfFor(cookie.value), Origin: new URL(baseURL).origin, "content-type": "application/json" };
  return async (method: string, url: string, data?: unknown) => {
    const r = await ctx.request.fetch(url, { method, headers, data });
    const j = await r.json();
    expect(r.ok(), j.error).toBe(true);
    return j;
  };
}
const ALL_ON = { daily: { active: true, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } };

test("no bonus-tier sections on any screen; programs still exist in Admin and the backend", async ({ browser, context, baseURL }) => {
  test.setTimeout(180_000);
  const call = await admin(context, baseURL!);
  const P = `E2E${Date.now() % 100000}`;
  const created: string[] = [];
  await call("PUT", "/api/admin/arena-config", { values: { rewardCategories: ALL_ON, arenaEnabled: true, arenaModes: { daily: true, weekly: true, monthly: true, spin: true }, showModeSelector: true } });
  try {
    for (const [k, n, amt] of [["daily", 2, 2000], ["daily", 3, 3000], ["weekly", 8, 8000], ["monthly", 30, 10000]] as const)
      created.push((await call("POST", "/api/admin/programs", { kind: k, name: `${P} ${k} ${n}`, rewardType: "cash", currency: "PKR", amount: amt, salesRequired: n, stackable: true, enabled: true })).program.id);

    const display = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 } });
    const page = await display.newPage();
    await page.goto("/");
    await expect(page.getByTestId("arena-screen-title")).toHaveText("Today's Bonus Floor", { timeout: 60_000 });
    await expect(page.getByTestId("top3-weekly")).toBeVisible();

    for (const screen of ["Daily Arena", "Weekly Arena", "Monthly Arena"]) {
      await page.getByRole("tablist", { name: "Live Arena screen" }).getByRole("tab", { name: screen }).click();
      await page.waitForTimeout(800);
      await expect(page.locator("[data-testid^=bonus-tiers]")).toHaveCount(0);
      await expect(page.getByTestId("bonus-tier")).toHaveCount(0);
      await expect(page.getByTestId("campaign-rule")).toHaveCount(0);
      const text = await page.locator("main").innerText();
      expect(text, screen).not.toMatch(/BONUS TIERS|STACKABLE|EARN EVERY TIER/i); // the compact per-agent "Earned …" indicators are allowed
      expect(text, screen).not.toMatch(/1 validated sale = Rs\.? ?1,000|Daily Validation Bonus/i);
      expect(text, screen).not.toContain(P); // configured program names / amounts are not shown permanently
    }
    await expect(page.getByTestId("bonus-popup")).toHaveCount(0); // nothing replayed on load

    // The programs are untouched: still listed in Admin and served to the popup runtime.
    const adminList = (await call("GET", "/api/admin/programs")).programs as Array<{ name: string; status: string }>;
    for (const name of [`${P} daily 2`, `${P} daily 3`, `${P} weekly 8`, `${P} monthly 30`]) expect(adminList.find((p) => p.name === name)?.status).toBe("active");
    const pub = (await (await page.request.get("/api/arena/programs")).json()).programs as Array<{ name: string }>;
    expect(pub.filter((p) => p.name.startsWith(P))).toHaveLength(4);
    await display.close();
  } finally {
    for (const id of created) await call("DELETE", `/api/admin/programs/${id}`).catch(() => {});
  }
});

test("Top 3 Weekly Performers fits fully on a 1920×1080 office display", async ({ browser }) => {
  const display = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 } });
  const page = await display.newPage();
  await page.goto("/");
  const podium = page.getByTestId("top3-weekly");
  await expect(podium).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  const box = await podium.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(1080);
  for (const card of await podium.locator("li").all()) {
    const b = await card.boundingBox();
    if (b) expect(b.y + b.height, "podium card bottom border visible").toBeLessThanOrEqual(1080);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await display.close();
});
