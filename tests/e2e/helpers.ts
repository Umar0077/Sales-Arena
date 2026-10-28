import { expect, type Page } from "@playwright/test";

/** Wait until React has hydrated and stored data has loaded; early clicks are otherwise lost. */
export async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-ready='true']", { state: "attached", timeout: 30000 });
  await expect(page.getByText("Loading live data…")).toHaveCount(0, { timeout: 15000 });
}
