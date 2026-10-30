import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { liveDataConfigured } from "./helpers";

/**
 * Production (live Safe Quote) mode: no demo data may ever be painted, on first load or
 * after a hard refresh, even with old demo records in localStorage and a slow network.
 */

const FORBIDDEN = ["Titans", "Falcons", "Phoenix", "Vipers", "Royals", "Fake Demoperson", "Team Captain"];

async function watchForDemoData(context: BrowserContext) {
  await context.addInitScript((forbidden: string[]) => {
    // Leftover demo state from an older version of the app.
    try {
      localStorage.setItem(
        "sales-arena:data",
        JSON.stringify({ state: { agents: [{ id: "agt_0_0", name: "Fake Demoperson", active: true }], teams: [{ id: "team_titans", name: "Titans" }], sales: [] }, version: 1 }),
      );
    } catch {}
    const w = window as unknown as { __seen: string[]; __liveBeforeData: boolean };
    w.__seen = [];
    w.__liveBeforeData = false;
    const check = () => {
      const text = document.body?.innerText ?? "";
      for (const n of forbidden) if (text.includes(n) && !w.__seen.includes(n)) w.__seen.push(n);
      if (text.includes("SAFE QUOTE LIVE") && document.querySelector("[data-testid=arena-skeleton]")) w.__liveBeforeData = true;
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
  }, FORBIDDEN);
}

async function slowNetwork(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 600, downloadThroughput: 400 * 1024, uploadThroughput: 200 * 1024 });
}

test.describe("live data (production mode)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await liveDataConfigured(page)), "Needs a server with Safe Quote configured.");
  });

  test("first render and hard refresh show a skeleton, then real data — never demo data", async ({ context, page }) => {
    test.setTimeout(90_000);
    await watchForDemoData(context);
    await slowNetwork(page);
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.getByTestId("arena-skeleton")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 45_000 });

    await page.reload({ waitUntil: "commit" }); // hard refresh
    await expect(page.getByTestId("arena-skeleton")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 45_000 });

    const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
    expect(seen).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __liveBeforeData: boolean }).__liveBeforeData)).toBe(false);
    // Old demo records were replaced, not restored.
    const stored = await page.evaluate(() => localStorage.getItem("sales-arena:data") ?? "");
    expect(stored).not.toContain("Fake Demoperson");
  });

  test("manual refresh re-fetches read-only, keeps the selected screen, and never writes", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 45_000 });
    await page.getByRole("tab", { name: "Weekly Arena" }).click();
    await expect(page.getByRole("tab", { name: "Weekly Arena" })).toHaveAttribute("aria-selected", "true");

    const requests: Array<{ url: string; method: string }> = [];
    page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
    const button = page.getByTestId("refresh-live");
    await button.click();
    await expect(button).toBeDisabled(); // no double clicks while running
    await expect(button).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId("refresh-status")).toContainText(/Updated/);

    const api = requests.filter((r) => r.url.includes("/api/"));
    expect(api.some((r) => r.url.includes("/api/arena/summary") && r.url.includes("fresh=true"))).toBe(true);
    expect(api.some((r) => r.url.includes("/api/arena/closers"))).toBe(true);
    expect(api.some((r) => r.url.includes("/api/arena/recent-sales"))).toBe(true);
    expect(api.some((r) => r.url.includes("/api/arena/targets"))).toBe(true);
    expect(api.filter((r) => r.method !== "GET")).toEqual([]); // read-only
    expect(api.filter((r) => r.url.includes("/api/arena/stream"))).toEqual([]); // no new SSE stream
    await expect(page.getByRole("tab", { name: "Weekly Arena" })).toHaveAttribute("aria-selected", "true");
  });

  test("a target saved in Admin drives the Live Arena KPIs", async ({ context }) => {
    test.setTimeout(90_000);
    const admin = await context.newPage();
    await admin.goto("/admin/targets");
    await expect(admin.getByTestId("target-completed")).not.toHaveText("—", { timeout: 30_000 });
    const completed = Number((await admin.getByTestId("target-completed").innerText()).replace(/,/g, ""));
    const target = completed + 7;
    await admin.getByTestId("target-input").fill(String(target));
    await admin.getByTestId("target-save").click();
    await expect(admin.getByText(/Target saved/)).toBeVisible();
    await expect(admin.getByTestId("target-current")).toHaveText(target.toLocaleString("en-US"));
    await expect(admin.getByTestId("target-remaining")).toHaveText("7");
    await expect(admin.getByTestId("target-history")).toContainText(String(target));

    const arena = await context.newPage();
    await arena.goto("/");
    await expect(arena.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 45_000 });
    await expect(arena.getByText("TODAY'S TARGET").locator("..").locator("..")).toContainText(target.toLocaleString("en-US"));

    // Clear it again so other runs start from "Not set".
    await admin.getByTestId("target-input").fill("0");
    await admin.getByTestId("target-save").click();
    await expect(admin.getByTestId("target-current")).toHaveText("Not set");
  });

  test("Admin Overview: Daily, Weekly and Monthly use their own date ranges; no teams", async ({ page }) => {
    test.setTimeout(90_000);
    const urls: string[] = [];
    page.on("request", (r) => r.url().includes("/api/arena/summary") && urls.push(r.url()));
    await page.goto("/admin");
    await expect(page.getByTestId("ov-validated")).toBeVisible({ timeout: 45_000 });
    for (const [tab, re] of [["Weekly", /This Week/], ["Monthly", /This Month/]] as const) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByTestId("ov-range")).toContainText(re, { timeout: 45_000 });
    }
    // Every summary request was date-filtered (never all-time data labelled as a period).
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => /from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/.test(u))).toBe(true);
    await expect(page.getByRole("link", { name: "Team Management" })).toHaveCount(0);
    await expect(page.getByText("Total Teams")).toHaveCount(0);
  });
});
