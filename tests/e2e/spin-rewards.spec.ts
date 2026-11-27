import { test, expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { liveDataConfigured } from "./helpers";

/** Fixture agent straight in the local DEV database; refuses any database not named *_dev. */
async function createDevAgent(userCode: string, name: string): Promise<boolean> {
  if (!existsSync(".env.local")) return false;
  const url = readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!url || !/\/sales_arena_dev(\?|$)/.test(url)) return false;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`INSERT INTO agents (id, user_code, name, initials) VALUES ($1, $2, $3, 'ET') ON CONFLICT DO NOTHING`, [`agt_${userCode}`, userCode, name]);
  } finally {
    await client.end();
  }
  return true;
}

/**
 * Scenario B (manual spin), end to end against the local DEV database (never production):
 * admin allocates → Live Arena popup without refresh → SPIN NOW → server-picked prize →
 * balance drops exactly once. Also: Daily Arena default and demo-button placement.
 */

const csrfFor = (token: string) => createHash("sha256").update(`csrf:${token}`).digest("base64url");

async function adminHeaders(context: BrowserContext, baseURL: string) {
  const cookie = (await context.cookies(baseURL)).find((c) => c.name.endsWith("sa_admin"));
  if (!cookie) throw new Error("no admin session");
  return { "x-csrf-token": csrfFor(cookie.value), Origin: new URL(baseURL).origin, "content-type": "application/json" };
}

async function spinStatus(api: APIRequestContext, code: string) {
  return (await api.get(`/api/arena/spin/status?userCode=${code}`)).json();
}

test.describe("spin rewards", () => {
  test("public arena opens on Daily Arena; Demo Spin only on Spin & Win", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("sales-arena:settings", JSON.stringify({ state: { defaultArenaMode: "spin" }, version: 4 }));
      } catch {}
    });
    await page.goto("/");
    await expect(page.getByRole("tab", { name: "Daily Arena" })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    await expect(page.getByTestId("demo-spin")).toHaveCount(0);
    for (const tab of ["Weekly Arena", "Monthly Arena"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByTestId("demo-spin")).toHaveCount(0);
    }
    await page.getByRole("tab", { name: "Spin & Win" }).click();
    await expect(page.getByTestId("demo-spin")).toBeVisible();
  });

  test("Scenario B: manual allocation → live popup → SPIN NOW → stored prize, balance −1 once", async ({ context, page, baseURL }) => {
    test.skip(!(await liveDataConfigured(page)), "Needs the live server with the dev database.");
    test.setTimeout(120_000);
    const headers = await adminHeaders(context, baseURL!);
    const api = context.request;
    const code = `E2E${Date.now().toString(36).toUpperCase()}`;

    // Test-only agent and prize in the dev database (admin APIs; no Safe Quote sale is faked).
    test.skip(!(await createDevAgent(code, "E2E Test Closer")), "Needs the local sales_arena_dev database.");
    // Reuse the test prize if it exists (adding one per run used to fill the wheel up to its 12-prize limit).
    const catalog = await (await api.get("/api/admin/catalog")).json();
    if (!(catalog.prizes ?? []).some((p: { title: string; active: boolean }) => p.title === "E2E Prize" && p.active))
      await api.post("/api/admin/catalog", { headers, data: { title: "E2E Prize", icon: "gift", color: "#FFC857", weight: 1, quantity: null } });

    // The Live Arena display (this browser has an admin session, so it may spin).
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(1500); // live stream connected

    const before = (await spinStatus(api, code)).available ?? 0;
    const key = `e2e-${randomUUID()}`;
    const alloc = await api.post("/api/admin/spins/allocate", { headers, data: { userCode: code, quantity: 1, reason: "E2E manual award", idempotencyKey: key } });
    expect(alloc.ok()).toBe(true);
    // A retry with the same key must not grant again.
    await api.post("/api/admin/spins/allocate", { headers, data: { userCode: code, quantity: 1, reason: "E2E manual award", idempotencyKey: key } });
    expect((await spinStatus(api, code)).available).toBe(before + 1);

    const popup = page.getByRole("dialog", { name: /CONGRATULATIONS, E2E/ });
    await expect(popup).toBeVisible({ timeout: 15_000 }); // no refresh needed
    await expect(popup).toContainText("BONUS SPIN AWARDED");
    await expect(popup).toContainText("Admin has awarded you 1 Spin!");
    await popup.getByRole("button", { name: "SPIN NOW" }).click();
    await expect(page.getByTestId("spin-agent-name")).toHaveText("E2E Test Closer", { timeout: 15_000 });
    await expect(page.getByTestId("spins-available")).toHaveText(String(before + 1), { timeout: 15_000 });

    const spinResp = page.waitForResponse((r) => r.url().endsWith("/api/arena/spin") && r.request().method() === "POST");
    await page.getByTestId("spin-button").click();
    const result = await (await spinResp).json();
    expect(result.ok).toBe(true);
    await expect(page.locator("[data-reveal-state]")).toBeVisible({ timeout: 30_000 });
    expect((await spinStatus(api, code)).available).toBe(before); // consumed exactly once

    const history = await (await api.get(`/api/admin/spins/history?userCode=${code}`, { headers })).json();
    expect(JSON.stringify(history)).toContain(code);
  });

  test("global spin notification appears on Weekly/Monthly/Daily Arena and persists across refresh until consumed", async ({ context, page, baseURL }) => {
    test.skip(!(await liveDataConfigured(page)), "Needs the live server with the dev database.");
    test.setTimeout(120_000);
    const headers = await adminHeaders(context, baseURL!);
    const api = context.request;
    const code = `E2EG${Date.now().toString(36).toUpperCase()}`;

    test.skip(!(await createDevAgent(code, "Global Spin Closer")), "Needs the local sales_arena_dev database.");
    const catalog = await (await api.get("/api/admin/catalog")).json();
    if (!(catalog.prizes ?? []).some((p: { title: string; active: boolean }) => p.title === "E2E Prize" && p.active))
      await api.post("/api/admin/catalog", { headers, data: { title: "E2E Prize", icon: "gift", color: "#FFC857", weight: 1, quantity: null } });

    await page.goto("/");
    await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 45_000 });
    // Switch to Weekly Arena before allocation
    await page.getByRole("tab", { name: "Weekly Arena" }).click();
    await page.waitForTimeout(1500);

    const alloc = await api.post("/api/admin/spins/allocate", {
      headers,
      data: { userCode: code, quantity: 1, reason: "Global mode check", idempotencyKey: `e2eg-${randomUUID()}` },
    });
    expect(alloc.ok()).toBe(true);

    // Immediate celebration appears on Weekly Arena with agent name & available balance
    const popup = page.getByRole("dialog", { name: /CONGRATULATIONS, GLOBAL/ });
    await expect(popup).toBeVisible({ timeout: 15_000 });
    await expect(popup.getByTestId("achievement-agent-name")).toHaveText("Global Spin Closer");
    await expect(popup.getByTestId("achievement-spins-balance")).toContainText("1 Available");

    // Dismissing popup leaves persistent non-blocking SPIN AVAILABLE invitation across modes & refresh
    await popup.getByRole("button", { name: /Spin later/i }).click();
    await expect(page.getByTestId(`pending-spin-${code}`)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("tab", { name: "Monthly Arena" }).click();
    await expect(page.getByTestId(`pending-spin-${code}`)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId(`pending-spin-${code}`)).toBeVisible({ timeout: 15_000 });

    // Consuming the spin from the persistent invitation removes it once completed
    await page.getByTestId(`pending-spin-cta-${code}`).click();
    await expect(page.getByTestId("spin-agent-name")).toHaveText("Global Spin Closer", { timeout: 15_000 });
    const spinResp = page.waitForResponse((r) => r.url().endsWith("/api/arena/spin") && r.request().method() === "POST");
    await page.getByTestId("spin-button").click();
    expect((await (await spinResp).json()).ok).toBe(true);
    await expect(page.locator("[data-reveal-state]")).toBeVisible({ timeout: 30_000 });
    expect((await spinStatus(api, code)).available).toBe(0);
  });

  test("two-TV isolation: pre-existing pending credits appear on both TVs on load; Spin Now opens wheel only on TV 1 and clears TV 2 on completion", async ({ context, page: tv1, baseURL }) => {
    test.skip(!(await liveDataConfigured(tv1)), "Needs the live server with the dev database.");
    test.setTimeout(120_000);
    const headers = await adminHeaders(context, baseURL!);
    const api = context.request;
    const code = `E2ETV${Date.now().toString(36).toUpperCase()}`;

    test.skip(!(await createDevAgent(code, "Multi TV Closer")), "Needs the local sales_arena_dev database.");
    const catalog = await (await api.get("/api/admin/catalog")).json();
    if (!(catalog.prizes ?? []).some((p: { title: string; active: boolean }) => p.title === "E2E Prize" && p.active))
      await api.post("/api/admin/catalog", { headers, data: { title: "E2E Prize", icon: "gift", color: "#FFC857", weight: 1, quantity: null } });

    // Pre-allocate 1 spin credit BEFORE either TV opens (verifies existing DB credits appear on initial load without allocating new ones).
    const alloc = await api.post("/api/admin/spins/allocate", {
      headers,
      data: { userCode: code, quantity: 1, reason: "Pre-existing credit", idempotencyKey: `e2etv-${randomUUID()}` },
    });
    expect(alloc.ok()).toBe(true);

    const tv2 = await context.newPage();
    await Promise.all([tv1.goto("/"), tv2.goto("/")]);
    await expect(tv1.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 45_000 });
    await expect(tv2.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 45_000 });

    // Both TV 1 and TV 2 show the pre-existing pending invitation on initial load.
    await expect(tv1.getByTestId(`pending-spin-${code}`)).toBeVisible({ timeout: 15_000 });
    await expect(tv2.getByTestId(`pending-spin-${code}`)).toBeVisible({ timeout: 15_000 });

    // Click SPIN NOW on TV 1 only.
    await tv1.getByTestId(`pending-spin-cta-${code}`).click();
    await expect(tv1.getByTestId("spin-agent-name")).toHaveText("Multi TV Closer", { timeout: 15_000 });
    // TV 2 must stay on its normal Arena screen (never open the wheel).
    await expect(tv2.getByTestId("spin-button")).toHaveCount(0);

    const spinResp = tv1.waitForResponse((r) => r.url().endsWith("/api/arena/spin") && r.request().method() === "POST");
    await tv1.getByTestId("spin-button").click();
    expect((await (await spinResp).json()).ok).toBe(true);
    await expect(tv1.locator("[data-reveal-state]")).toBeVisible({ timeout: 30_000 });

    // TV 2's pending invitation disappears once the credit is consumed.
    await expect(tv2.getByTestId(`pending-spin-${code}`)).toHaveCount(0, { timeout: 15_000 });
    await tv2.close();
  });
});
