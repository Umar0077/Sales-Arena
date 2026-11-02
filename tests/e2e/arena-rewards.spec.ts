import { test, expect, type BrowserContext } from "@playwright/test";
import { createHash } from "node:crypto";

/**
 * Live Arena reward display is fully database-driven. Programs are created through the Admin API on
 * the DEV database (same values as production, for verification), and archived again at the end.
 * No sales, awards or spin credits are created.
 */
const csrfFor = (t: string) => createHash("sha256").update(`csrf:${t}`).digest("base64url");
async function admin(ctx: BrowserContext, baseURL: string) {
  const cookie = (await ctx.cookies(baseURL)).find((c) => c.name.endsWith("sa_admin"))!;
  const headers = { "x-csrf-token": csrfFor(cookie.value), Origin: new URL(baseURL).origin, "content-type": "application/json" };
  const call = async (method: string, url: string, data?: unknown) => {
    const r = await ctx.request.fetch(url, { method, headers, data });
    const j = await r.json();
    expect(r.ok(), j.error).toBe(true);
    return j;
  };
  return call;
}
const ALL_ON = { daily: { active: true, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } };

test("Daily/Weekly tiers come from PostgreSQL, update live, and the old Rs. 1,000 rule never appears", async ({ browser, context, baseURL }) => {
  test.setTimeout(240_000);
  const call = await admin(context, baseURL!);
  const P = `E2E${Date.now() % 100000}`;
  const created: string[] = [];
  await call("PUT", "/api/admin/arena-config", { values: { rewardCategories: ALL_ON, arenaEnabled: true, arenaModes: { daily: true, weekly: true, monthly: true, spin: true }, showModeSelector: true } });
  try {
    for (const [n, amt] of [[2, 2000], [3, 3000], [4, 5000], [5, 7000]])
      created.push((await call("POST", "/api/admin/programs", { kind: "daily", name: `${P} D${n}`, rewardType: "cash", currency: "PKR", amount: amt, salesRequired: n, stackable: true, enabled: true })).program.id);
    for (const [n, amt] of [[8, 8000], [10, 12000], [12, 16000], [15, 23000]])
      created.push((await call("POST", "/api/admin/programs", { kind: "weekly", name: `${P} W${n}`, rewardType: "cash", currency: "PKR", amount: amt, salesRequired: n, stackable: true, enabled: true })).program.id);

    const display = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await display.newPage();
    await page.goto("/");
    const strip = page.getByTestId("bonus-tiers-daily");
    await expect(strip).toBeVisible({ timeout: 60_000 });
    const tier = (name: string) => strip.locator(`[data-testid=bonus-tier][title="${name}"]`);
    for (const [n, amt] of [[2, "PKR 2,000"], [3, "+PKR 3,000"], [4, "+PKR 5,000"], [5, "+PKR 7,000"]]) await expect(tier(`${P} D${n}`)).toContainText(String(amt));
    await expect(tier(`${P} D3`)).toContainText("Total PKR 5,000"); // stackable: 2,000 + 3,000
    await expect(tier(`${P} D5`)).toContainText("Total PKR 17,000");

    // The old hard-coded rule is gone, even if a browser still has the demo programs stored.
    await page.evaluate(() => {
      localStorage.setItem("sales-arena:reward-programs", JSON.stringify({ state: { programs: [{ id: "prog_daily", kind: "daily", name: "Daily Validation Bonus", enabled: true, salesRequired: 1, amount: 1000 }], awards: [] }, version: 1 }));
      window.dispatchEvent(new StorageEvent("storage", { key: "sales-arena:reward-programs" }));
    });
    await page.waitForTimeout(500);
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/1 validated sale = Rs\.? ?1,000/i);
    expect(body).not.toContain("Daily Validation Bonus");
    await expect(page.getByTestId("campaign-rule")).toHaveCount(0);

    // Earned today = PostgreSQL bonus_awards total (a genuine value, possibly zero).
    const s = (await (await page.request.get("/api/arena/awards")).json()).summary.daily;
    await expect(page.getByTestId("bonus-earned-daily")).toContainText(`${s.currency} ${Math.round(s.earned).toLocaleString("en-US")} earned today`);
    await expect(page.getByTestId("bonus-popup")).toHaveCount(0); // no historical award replay on load

    // Admin edits reach the open display without a reload.
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
    await call("PATCH", `/api/admin/programs/${created[0]}`, { amount: 2500 });
    await expect(tier(`${P} D2`)).toContainText("PKR 2,500", { timeout: 10_000 });
    await expect(tier(`${P} D3`)).toContainText("Total PKR 5,500");
    await call("PATCH", `/api/admin/programs/${created[3]}`, { enabled: false });
    await expect(tier(`${P} D5`)).toHaveCount(0, { timeout: 10_000 });
    await call("PUT", "/api/admin/arena-config", { values: { rewardCategories: { ...ALL_ON, daily: { active: true, showOnArena: false } } } });
    await expect(strip).toHaveCount(0, { timeout: 10_000 });
    await call("PUT", "/api/admin/arena-config", { values: { rewardCategories: { ...ALL_ON, daily: { active: false, showOnArena: true } } } });
    await expect(strip).toHaveAttribute("data-state", "paused", { timeout: 10_000 });
    await call("PUT", "/api/admin/arena-config", { values: { rewardCategories: ALL_ON } });
    await expect(tier(`${P} D2`)).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);

    // Weekly Arena: its own tiers. Monthly: none of these (nothing invented).
    await page.getByRole("tablist", { name: "Live Arena screen" }).getByRole("tab", { name: "Weekly Arena" }).click();
    const weekly = page.getByTestId("bonus-tiers-weekly");
    for (const [n, amt] of [[8, "PKR 8,000"], [10, "+PKR 12,000"], [12, "+PKR 16,000"], [15, "+PKR 23,000"]])
      await expect(weekly.locator(`[data-testid=bonus-tier][title="${P} W${n}"]`)).toContainText(String(amt));
    await expect(weekly.locator(`[title="${P} W10"]`)).toContainText("Total PKR 20,000");
    const w = (await (await page.request.get("/api/arena/awards")).json()).summary.weekly;
    await expect(page.getByTestId("period-bonuses-earned")).toHaveText(`${w.currency} ${Math.round(w.earned).toLocaleString("en-US")}`);
    await page.getByRole("tablist", { name: "Live Arena screen" }).getByRole("tab", { name: "Monthly Arena" }).click();
    await expect(page.getByTestId("bonus-tiers-monthly")).toBeVisible();
    await expect(page.getByTestId("bonus-tiers-monthly").locator(`[title^="${P}"]`)).toHaveCount(0);
    await display.close();
  } finally {
    for (const id of created) await call("DELETE", `/api/admin/programs/${id}`).catch(() => {});
    await call("PUT", "/api/admin/arena-config", { values: { rewardCategories: ALL_ON } }).catch(() => {});
  }
});
