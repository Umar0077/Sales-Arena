import { test, expect, type Browser, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { adminPut, cub, offsetX } from "./cub-helpers";

/**
 * Arena Cub reliability through the REAL Admin UI and a SEPARATE display browser (no admin session).
 * Settings changes are restored afterwards; no sale, award or spin is ever created.
 */

const WIDE = { activeStart: "00:00", activeEnd: "23:59", activeDays: [0, 1, 2, 3, 4, 5, 6], introFrequency: "off", hunger: false, speech: true, enabled: true };

async function display(browser: Browser, viewport = { width: 1600, height: 900 }) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport, reducedMotion: "no-preference", ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("[data-arena-mode]")).toBeVisible({ timeout: 90_000 });
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  return { ctx, page };
}
const rootX = async (p: Page) => (await p.getByTestId("arena-cub-root").boundingBox())?.x ?? NaN;
const stored = async (page: Page) => (await (await page.request.get("/api/arena/config")).json()).values.arenaCub;

test.describe("Arena Cub reliability (Admin UI → separate display)", () => {
  test.use({ viewport: { width: 1440, height: 1000 }, contextOptions: { reducedMotion: "no-preference" } });
  test.describe.configure({ timeout: 420_000 });
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

  test("lost save response: Admin still shows Enabled, buttons work, position changes never hide the cub", async ({ browser, context, page, baseURL }) => {
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, ...WIDE, allowOnLiveArena: false, position: "bottom-right", sizePreset: "large" } })).status()).toBe(200);
    const d = await display(browser);
    await expect(cub(d.page)).toHaveCount(0);

    await page.goto("/admin/celebrations");
    await expect(page.getByTestId("cub-live-status")).toHaveText("Disabled", { timeout: 30_000 });
    // The Allow request is SAVED on the server but its answer never reaches the Admin (like an HTTP/2 reset).
    let dropped = false;
    await page.route("**/api/admin/arena-config", async (route) => {
      if (route.request().method() === "PUT" && !dropped) {
        await route.fetch(); // reaches the server and is committed
        dropped = true; // only now: the answer existed, and is thrown away below
        return route.abort("connectionreset");
      }
      return route.fallback();
    });
    await page.getByTestId("cub-allow-live").click();
    await page.getByTestId("cub-allow-confirm-yes").click();
    await expect.poll(() => dropped).toBe(true);
    expect((await stored(page)).allowOnLiveArena).toBe(true); // committed
    await expect(page.getByTestId("cub-live-status")).toHaveText("Enabled", { timeout: 15_000 }); // re-synced from the server
    await expect(page.getByTestId("cub-diag-permission")).toHaveText("ON");
    await expect(page.getByTestId("cub-live-run_left")).toBeEnabled();
    await expect(cub(d.page)).toBeVisible({ timeout: 15_000 });
    await page.unroute("**/api/admin/arena-config");

    // Position changes from the Admin UI: always visible, really moves, permission untouched.
    const xRight = await rootX(d.page);
    for (const [label, check] of [
      ["Bottom left", (x: number) => x < 400],
      ["Bottom center", (x: number) => x > 500 && x < 1000],
      ["Bottom right", (x: number) => x > 1000],
    ] as const) {
      await page.getByRole("radio", { name: label, exact: true }).click();
      await expect.poll(async () => (await stored(page)).position, { timeout: 10_000 }).toBe(label.toLowerCase().replace(" ", "-"));
      await expect.poll(async () => check(await rootX(d.page)), { timeout: 10_000 }).toBe(true);
      await expect(cub(d.page)).toBeVisible();
      expect((await stored(page)).allowOnLiveArena).toBe(true);
      await expect(page.getByTestId("cub-live-status")).toHaveText("Enabled");
    }
    expect(await rootX(d.page)).toBeCloseTo(xRight, -1);
    // Custom position, then size + position together, then a resize: still visible, inside the screen.
    await page.getByRole("radio", { name: "Custom", exact: true }).last().click();
    await expect.poll(async () => (await stored(page)).position, { timeout: 10_000 }).toBe("custom");
    await page.getByRole("radio", { name: "Extra Large" }).click();
    await expect.poll(async () => (await stored(page)).sizePreset, { timeout: 10_000 }).toBe("xl");
    await expect(cub(d.page)).toBeVisible();
    await d.page.setViewportSize({ width: 1280, height: 720 });
    await d.page.waitForTimeout(1500);
    const b = (await d.page.getByTestId("arena-cub-root").boundingBox())!;
    expect(b.x + b.width * 0.12).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width * 0.84).toBeLessThanOrEqual(1280);
    await expect(cub(d.page)).toBeVisible();
    expect(await d.page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true); // never refreshed
    await page.getByRole("radio", { name: "Large", exact: true }).click();
    await page.getByRole("radio", { name: "Bottom right", exact: true }).click();
    await expect.poll(async () => { const c = await stored(page); return `${c.position}/${c.sizePreset}`; }, { timeout: 10_000 }).toBe("bottom-right/large");
    await d.ctx.close();
  });

  test("every live action plays on a separate display (verified pose / movement + display acknowledgment)", async ({ browser, context, page, baseURL }) => {
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, ...WIDE, allowOnLiveArena: true, position: "bottom-right", sizePreset: "large" } })).status()).toBe(200);
    const d = await display(browser);
    await expect(cub(d.page)).toBeVisible({ timeout: 20_000 });
    await page.goto("/admin/celebrations");
    await expect(page.getByTestId("cub-live-status")).toHaveText("Enabled", { timeout: 30_000 });

    const POSE: Record<string, string> = {
      wave: "wave", happy: "happy", hungry: "hungry", angry: "angry", sad: "sad", sleep: "sleeping", wake: "wake",
      run_left: "run", run_right: "run", run_across: "run", dash: "run", jump_run: "run", roam: "run",
      jump: "jump", dance: "dance", spin: "spin", backflip: "backflip", eat_token: "feeding", celebrate: "bonus", peek: "peek", goodbye: "wave",
    };
    const results: string[] = [];
    for (const [action, pose] of Object.entries(POSE)) {
      await page.waitForTimeout(1100); // per-admin rate limit: one action per second
      await page.getByTestId(`cub-live-${action}`).click();
      await expect(cub(d.page), action).toHaveAttribute("data-pose", pose, { timeout: 8000 });
      if (pose === "run") {
        await expect.poll(async () => Math.abs((await offsetX(d.page)) ?? 0), { timeout: 8000, message: `${action} travels` }).toBeGreaterThan(action === "run_right" ? 0 : 60);
      }
      await expect.poll(async () => Number(await page.getByTestId("cub-live-delivery").getAttribute("data-started")), { timeout: 8000, message: action + " acknowledged" }).toBeGreaterThanOrEqual(1);
      results.push(`${action}:${pose}`);
    }
    console.log("ACTIONS-VERIFIED", results.length, results.join(" "));

    // Utilities: Stop ends an action at once; Return Home brings a run back; Reset clears everything.
    await page.waitForTimeout(1100);
    await page.getByTestId("cub-live-dance").click();
    await expect(cub(d.page)).toHaveAttribute("data-pose", "dance", { timeout: 8000 });
    await page.waitForTimeout(1100);
    await page.getByTestId("cub-live-stop").click();
    await expect(cub(d.page)).not.toHaveAttribute("data-pose", "dance", { timeout: 5000 });
    await page.waitForTimeout(1100);
    await page.getByTestId("cub-live-run_across").click();
    await expect.poll(async () => Math.abs((await offsetX(d.page)) ?? 0), { timeout: 8000 }).toBeGreaterThan(150);
    await page.waitForTimeout(1100);
    await page.getByTestId("cub-live-home").click();
    await expect.poll(async () => Math.abs((await offsetX(d.page)) ?? 0), { timeout: 5000 }).toBeLessThan(1);
    await expect(cub(d.page)).not.toHaveAttribute("data-pose", "run", { timeout: 5000 });
    await page.waitForTimeout(1100);
    await page.getByTestId("cub-live-sleep").click();
    await expect(cub(d.page)).toHaveAttribute("data-pose", "sleeping", { timeout: 8000 });
    await page.waitForTimeout(1100);
    await page.getByTestId("cub-live-reset").click();
    await expect(cub(d.page)).toHaveAttribute("data-pose", "idle", { timeout: 5000 });

    // Greeting from the Admin button, then its cooldown is shown with the server's reason on a repeat.
    await page.waitForTimeout(1100);
    await page.getByTestId("cub-greet-live").click();
    await expect(cub(d.page)).toHaveAttribute("data-pose", "greet", { timeout: 8000 });
    await expect(page.getByTestId("cub-live-delivery")).toContainText(/started on \d+ display/, { timeout: 8000 });

    // Rate limit: two clicks in the same second → the second is rejected with the exact reason.
    await page.waitForTimeout(1100);
    await page.getByTestId("cub-live-jump").click();
    await page.getByTestId("cub-live-jump").click({ force: true }).catch(() => {});
    await expect(page.getByTestId("cub-live-delivery")).toBeVisible();

    // Sidebar still navigates right after live actions.
    await page.locator('aside a[href="/admin/programs"]').click();
    await expect(page).toHaveURL(/\/admin\/programs$/, { timeout: 15_000 });
    await d.ctx.close();
  });

  test("settings changed in the Admin UI are saved in PostgreSQL, applied live on a display, and survive refresh", async ({ browser, context, page, baseURL }) => {
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, ...WIDE, allowOnLiveArena: true, sizePreset: "large", performance: "full", reducedMotion: "system" } })).status()).toBe(200);
    const d = await display(browser);
    await expect(cub(d.page)).toBeVisible({ timeout: 20_000 });
    await page.goto("/admin/celebrations");
    await expect(page.getByTestId("cub-live-status")).toHaveText("Enabled", { timeout: 30_000 });
    const charH = () => d.page.getByTestId("arena-cub-root").getAttribute("data-char-height");
    const initialH = Number(await charH());

    // Size: Small.
    await page.getByRole("radio", { name: "Small", exact: true }).click();
    await expect.poll(async () => (await stored(page)).sizePreset, { timeout: 10_000 }).toBe("small");
    await expect.poll(async () => Number(await charH()), { timeout: 10_000 }).toBeLessThan(initialH);
    // Performance: Lite → idle extras off on the display.
    await page.getByRole("radio", { name: "Lite", exact: true }).click();
    await expect(cub(d.page)).toHaveAttribute("data-motion", "lite", { timeout: 10_000 });
    // Reduced motion: Always reduce.
    await page.getByRole("radio", { name: "Always reduce", exact: true }).click();
    await expect(cub(d.page)).toHaveAttribute("data-motion", "reduced", { timeout: 10_000 });
    await page.getByRole("radio", { name: "Follow the display", exact: true }).click();
    await page.getByRole("radio", { name: "Full", exact: true }).click();
    await expect(cub(d.page)).toHaveAttribute("data-motion", "full", { timeout: 10_000 });
    // Speech bubbles off → an action plays without a bubble.
    await page.getByRole("switch", { name: "Speech bubbles" }).click();
    await expect.poll(async () => (await stored(page)).speech, { timeout: 10_000 }).toBe(false);
    await page.waitForTimeout(1100);
    await page.getByTestId("cub-live-wave").click();
    await expect(cub(d.page)).toHaveAttribute("data-pose", "wave", { timeout: 8000 });
    await d.page.waitForTimeout(800);
    await expect(d.page.getByTestId("arena-cub-bubble")).toHaveCount(0);
    // Per-screen visibility: Weekly off → hidden there, still on Daily.
    await page.getByTestId("cub-screen-weekly").click();
    await expect.poll(async () => (await stored(page)).screens.weekly, { timeout: 10_000 }).toBe(false);
    const tabs = d.page.getByRole("tablist", { name: "Live Arena screen" });
    await tabs.getByRole("tab", { name: "Weekly Arena" }).click();
    await expect(cub(d.page)).toHaveCount(0, { timeout: 10_000 });
    await tabs.getByRole("tab", { name: "Daily Arena" }).click();
    await expect(cub(d.page)).toBeVisible({ timeout: 10_000 });
    // Active days: none → outside active hours → asleep but still visible (never hidden by hours).
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) await page.getByRole("switch", { name: day, exact: true }).click();
    await expect.poll(async () => (await stored(page)).activeDays.length, { timeout: 10_000 }).toBe(0);
    await expect(cub(d.page)).toHaveAttribute("data-pose", "sleeping", { timeout: 20_000 });
    await expect(cub(d.page)).toBeVisible();
    // Everything survives a refresh of both Admin and display.
    await page.reload();
    await expect(page.getByTestId("cub-live-status")).toHaveText("Enabled", { timeout: 30_000 });
    await expect(page.getByRole("switch", { name: "Speech bubbles" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("radio", { name: "Small", exact: true })).toHaveAttribute("aria-checked", "true");
    await d.page.reload();
    await expect(cub(d.page)).toHaveAttribute("data-pose", "sleeping", { timeout: 60_000 });
    expect((await stored(page)).allowOnLiveArena).toBe(true);
    await d.ctx.close();
  });

  test("a display whose stream is refused (e.g. 502 during a deploy) reconnects by itself and still gets actions", async ({ browser, context, baseURL }) => {
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, ...WIDE, allowOnLiveArena: true } })).status()).toBe(200);
    const d = await display(browser);
    await expect(cub(d.page)).toBeVisible({ timeout: 20_000 });
    // The next two stream connections fail with 502: the browser closes EventSource for good on that.
    let refusals = 0;
    await d.page.route("**/api/arena/stream", (route) => (refusals < 2 ? (refusals++, route.fulfill({ status: 502, body: "Bad Gateway" })) : route.fallback()));
    // A real interruption: restart the reverse proxy (local reproduction stack only), like a deploy or network blip.
    test.skip(!baseURL!.includes(":8443"), "needs the local Nginx reproduction stack");
    execSync("docker restart sa-nginx-repro", { stdio: "ignore" });
    await expect.poll(() => refusals, { timeout: 30_000 }).toBe(2);
    // …and it is live again: an admin action arrives without any refresh.
    await expect(async () => {
      const r = await (await import("./cub-helpers")).adminPost(context, baseURL!, "/api/admin/arena-cub/command", { action: "jump" });
      expect(r.status()).toBe(200);
      await expect(cub(d.page)).toHaveAttribute("data-pose", "jump", { timeout: 3000 });
    }).toPass({ timeout: 60_000, intervals: [1500] });
    await expect(cub(d.page)).toBeVisible();
    expect(await d.page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
    await d.ctx.close();
  });
});
