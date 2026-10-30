import { expect, type Page } from "@playwright/test";

/** Wait until React has hydrated and stored data has loaded; early clicks are otherwise lost. */
export async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-ready='true']", { state: "attached", timeout: 30000 });
  await expect(page.getByText("Loading live data…")).toHaveCount(0, { timeout: 15000 });
}

/**
 * True when the server has Safe Quote configured. Then spins are server-authoritative
 * (database ledger), so browser-only simulator sales cannot unlock them by design.
 */
export async function liveDataConfigured(page: Page): Promise<boolean> {
  const res = await page.request.get("/api/arena/summary");
  return res.ok();
}
