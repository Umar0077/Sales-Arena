import { test, expect, type Browser, type Page } from "@playwright/test";
import { adminPost, adminPut, cub, minsAgo, offsetX, poses, rig, SHOTS, sse } from "./cub-helpers";

/**
 * Arena Cub V2: OFF by default, live admin commands observed on SEPARATE display browsers (no admin
 * session), targeting, greeting, admin Preview Studio, interruption / resize / duplicate / expired commands.
 * Settings saves are restored afterwards; no sale, award or spin is ever created.
 */

const WIDE = { activeStart: "00:00", activeEnd: "23:59", activeDays: [0, 1, 2, 3, 4, 5, 6], introFrequency: "off", hunger: false, position: "bottom-right", sizePreset: "large" };

async function display(browser: Browser, viewport = { width: 1600, height: 900 }) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport, reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __poses: string[] };
    w.__poses = [];
    setInterval(() => {
      const el = document.querySelector('[data-testid="arena-cub"]') as HTMLElement | null;
      const p = el ? `${el.dataset.pose}${el.dataset.move ? ":" + el.dataset.move : ""}` : "none";
      if (w.__poses[w.__poses.length - 1] !== p) w.__poses.push(p);
    }, 60);
  });
  await page.goto("/");
  await expect(page.locator("[data-arena-mode]")).toBeVisible({ timeout: 90_000 });
  return { ctx, page };
}

async function rootBox(p: Page) {
  const b = await p.getByTestId("arena-cub-root").boundingBox();
  return b && { x: Math.round(b.x), y: Math.round(b.y) };
}

/** Waits for a run on this display: travels away, cycles the legs, comes back to exactly home. */
async function expectRunAndReturn(p: Page, shot?: string) {
  const home = await rootBox(p);
  await expect(cub(p)).toHaveAttribute("data-pose", "run", { timeout: 8000 });
  await expect.poll(async () => Math.abs((await offsetX(p)) ?? 0), { timeout: 8000 }).toBeGreaterThan(120);
  await expect(cub(p)).toHaveAttribute("data-move", "run");
  // The legs really cycle (CSS animations running on both leg groups).
  const legs = await p.evaluate(() => [".cub-leg-l", ".cub-leg-r"].map((s) => document.querySelector(s)!.getAnimations().length));
  expect(legs.every((n) => n > 0)).toBe(true);
  if (shot) await p.screenshot({ path: `${SHOTS}/${shot}`, animations: "allow" });
  await expect(cub(p)).not.toHaveAttribute("data-pose", "run", { timeout: 15_000 });
  expect(Math.abs((await offsetX(p)) ?? 0)).toBeLessThan(1); // exactly home
  expect(await rootBox(p)).toEqual(home);
  expect((await poses(p)).join(" ")).toMatch(/run:prep.*run:run.*run:turn.*run:run.*run:settle/);
}

test.describe("Arena Cub V2 — live", () => {
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

  test("OFF by default: no public cub, and browser storage / URL cannot turn it on", async ({ browser, context, baseURL }) => {
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, ...WIDE, allowOnLiveArena: false } })).status()).toBe(200);
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1600, height: 900 } });
    const p = await ctx.newPage();
    // A tampered cache claiming the cub is allowed.
    await p.addInitScript(() => {
      try {
        const raw = localStorage.getItem("sales-arena:settings");
        const v = raw ? JSON.parse(raw) : { state: {}, version: 5 };
        v.state.arenaCub = { ...(v.state.arenaCub ?? {}), allowOnLiveArena: true, enabled: true };
        localStorage.setItem("sales-arena:settings", JSON.stringify(v));
      } catch {
        /* ignore */
      }
    });
    await p.goto("/?cub=1&allowOnLiveArena=true");
    await expect(p.locator("[data-arena-mode]")).toBeVisible({ timeout: 90_000 });
    await p.waitForTimeout(5000);
    await expect(cub(p)).toHaveCount(0);
    // Public clients cannot change the permission.
    const anon = await p.request.put("/api/admin/arena-config", { data: { values: { arenaCub: { ...before, allowOnLiveArena: true } } } });
    expect([401, 403]).toContain(anon.status());
    const cmd = await p.request.post("/api/admin/arena-cub/command", { data: { action: "greet" } });
    expect([401, 403]).toContain(cmd.status());
    await ctx.close();
  });

  test("Admin live actions are observed on two separate displays; targeting, greeting, hide", async ({ browser, context, baseURL }) => {
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, ...WIDE, allowOnLiveArena: true, enabled: true, sizePreset: "large", position: "bottom-right" } })).status()).toBe(200);
    const a = await display(browser);
    const b = await display(browser, { width: 1366, height: 768 });
    for (const d of [a, b]) await expect(cub(d.page)).toBeVisible({ timeout: 20_000 });
    await a.page.screenshot({ path: `${SHOTS}/v2-home-1600.png`, animations: "allow" });

    // Run across, on every live screen.
    const r = await adminPost(context, baseURL!, "/api/admin/arena-cub/command", { action: "run_across", target: { scope: "all" } });
    expect(r.status(), await r.text()).toBe(200);
    await Promise.all([expectRunAndReturn(a.page, "v2-run-across-1600.png"), expectRunAndReturn(b.page, "v2-run-across-1366.png")]);

    // Daily only: display B switches to Weekly and must not react.
    await b.page.getByRole("tablist", { name: "Live Arena screen" }).getByRole("tab", { name: "Weekly Arena" }).click();
    await expect(b.page.locator("[data-arena-mode]")).toHaveAttribute("data-arena-mode", "weekly");
    await b.page.evaluate(() => ((window as unknown as { __poses: string[] }).__poses = []));
    await a.page.waitForTimeout(1200);
    expect((await adminPost(context, baseURL!, "/api/admin/arena-cub/command", { action: "jump", target: { scope: "screen", screen: "daily" } })).status()).toBe(200);
    await expect(cub(a.page)).toHaveAttribute("data-pose", "jump", { timeout: 8000 });
    await b.page.waitForTimeout(2500);
    expect(await poses(b.page)).not.toContain("jump");

    // Greeting on all live screens: three readable lines, then home. No replay after a reload.
    await a.page.waitForTimeout(1200);
    expect((await adminPost(context, baseURL!, "/api/admin/arena-cub/command", { action: "greet" })).status()).toBe(200);
    for (const d of [a, b]) await expect(cub(d.page)).toHaveAttribute("data-pose", "greet", { timeout: 8000 });
    await expect(a.page.getByTestId("arena-cub-bubble")).toContainText("I'm Arena Cub", { timeout: 6000 });
    await a.page.screenshot({ path: `${SHOTS}/v2-greet-1.png`, animations: "allow" });
    await expect(a.page.getByTestId("arena-cub-bubble")).toContainText("genuine validated sale feeds me", { timeout: 6000 });
    await expect(b.page.getByTestId("arena-cub-bubble")).toContainText("ROAR!", { timeout: 8000 });
    await b.page.screenshot({ path: `${SHOTS}/v2-greet-3.png`, animations: "allow" });
    expect((await adminPost(context, baseURL!, "/api/admin/arena-cub/command", { action: "greet" })).status()).toBe(429); // cooldown
    await expect(cub(a.page)).not.toHaveAttribute("data-pose", "greet", { timeout: 10_000 });
    await a.page.reload();
    await expect(cub(a.page)).toBeVisible({ timeout: 60_000 });
    await a.page.waitForTimeout(3000);
    expect(await poses(a.page)).not.toContain("greet");

    // Hide from all live screens: gone immediately, no refresh.
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, ...WIDE, allowOnLiveArena: false } })).status()).toBe(200);
    for (const d of [a, b]) await expect(cub(d.page)).toHaveCount(0, { timeout: 15_000 });
    // …and stays hidden after a refresh.
    await b.page.reload();
    await expect(b.page.locator("[data-arena-mode]")).toBeVisible({ timeout: 60_000 });
    await b.page.waitForTimeout(3000);
    await expect(cub(b.page)).toHaveCount(0);
    await a.ctx.close();
    await b.ctx.close();
  });

  test("Admin UI: Preview Studio stays private; Allow (confirmed) → live; a live button is observed on a separate display", async ({ browser, context, page, baseURL }) => {
    expect((await adminPut(context, baseURL!, { arenaCub: { ...before, ...WIDE, allowOnLiveArena: false, enabled: true } })).status()).toBe(200);
    const d = await display(browser);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.url().includes("/api/")) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await page.goto("/admin/celebrations");
    await expect(page.getByTestId("cub-live-status")).toHaveText("Disabled", { timeout: 30_000 });
    await expect(page.getByTestId("cub-preview-status")).toHaveText("Visible");

    // Private preview: animates in Admin only, sends nothing.
    const preview = page.getByTestId("cub-preview");
    await page.getByTestId("cub-preview-stage").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Preview Run Across Screen" }).click();
    await expect(preview).toHaveAttribute("data-pose", "run", { timeout: 5000 });
    await expect.poll(async () => Math.abs((await offsetX(page, "cub-preview")) ?? 0), { timeout: 6000 }).toBeGreaterThan(80);
    await page.getByTestId("cub-preview-stage").screenshot({ path: `${SHOTS}/v2-preview-run.png`, animations: "allow" });
    await expect(preview).not.toHaveAttribute("data-pose", "run", { timeout: 15_000 });
    expect(Math.abs((await offsetX(page, "cub-preview")) ?? 0)).toBeLessThan(1);
    for (const [label, pose] of [["Preview Greeting", "greet"], ["Preview Dance", "dance"], ["Preview Jump", "jump"], ["Preview Feeding (golden token)", "feeding"], ["Preview Bonus Celebration", "bonus"], ["Preview Hungry", "hungry"]] as const) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(preview).toHaveAttribute("data-pose", pose, { timeout: 5000 });
      await page.waitForTimeout(pose === "greet" ? 3200 : 900);
      await page.getByTestId("cub-preview-stage").screenshot({ path: `${SHOTS}/v2-preview-${pose}.png`, animations: "allow" });
    }
    await page.getByRole("button", { name: "Preview Stop Animation" }).click();
    await page.getByTestId("cub-preview-hide").click();
    await expect(page.getByTestId("cub-preview-status")).toHaveText("Hidden");
    await expect(preview).toHaveCount(0);
    await page.getByTestId("cub-preview-show").click();
    expect(writes).toEqual([]); // nothing sent by the preview
    await expect(cub(d.page)).toHaveCount(0); // public display untouched

    // Live buttons are off until the cub is allowed.
    await expect(page.getByTestId("cub-live-run_left")).toBeDisabled();
    await page.getByTestId("cub-allow-live").click();
    await expect(page.getByTestId("cub-allow-confirm")).toBeVisible();
    await page.getByTestId("cub-allow-confirm-yes").click();
    await expect(page.getByTestId("cub-live-status")).toHaveText("Enabled", { timeout: 10_000 });
    await expect(cub(d.page)).toBeVisible({ timeout: 20_000 }); // separate display, no refresh

    await page.getByTestId("cub-live-run_left").click();
    await expect(page.getByTestId("cub-live-delivery")).toHaveAttribute("data-phase", "accepted", { timeout: 10_000 });
    await expectRunAndReturn(d.page, "v2-ui-run-left.png");
    // The display itself reported playing it (evidence, not just "sent").
    await expect.poll(async () => Number(await page.getByTestId("cub-live-delivery").getAttribute("data-started")), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

    await page.getByTestId("cub-hide-live").click();
    await expect(cub(d.page)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("cub-live-status")).toHaveText("Disabled");
    await d.ctx.close();
  });
});

test.describe("Arena Cub V2 — movement safety (stream-controlled display)", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1600, height: 900 }, contextOptions: { reducedMotion: "no-preference" } });
  test.describe.configure({ timeout: 180_000 });
  const command = (action: string, id: string, ttl = 60_000) => sse("arena.cub.action", { id, action, target: { scope: "all" }, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ttl).toISOString() });

  test("repeated command ids run once; expired commands never run", async ({ page }) => {
    const r = await rig(page);
    const id = `e2e-${Date.now()}`;
    await r.open({ lastSaleAt: minsAgo(2), retry: 1500 });
    await expect(cub(page)).toBeVisible({ timeout: 15_000 });
    r.stream(command("dance", id) + command("dance", id) + command("backflip", `${id}-old`, -5000), 4); // redelivered on reconnects
    await expect(cub(page)).toHaveAttribute("data-pose", "dance", { timeout: 8000 });
    await page.waitForTimeout(9000); // several reconnects redeliver the same events
    const seq = await poses(page);
    expect(seq.filter((p) => p === "dance")).toHaveLength(1);
    expect(seq).not.toContain("backflip");
  });

  test("a genuine sale interrupts a run: the cub runs home, then feeds", async ({ page }) => {
    const r = await rig(page);
    await r.open({ lastSaleAt: minsAgo(2), retry: 1500 });
    await expect(cub(page)).toBeVisible({ timeout: 15_000 });
    const id = `e2e-int-${Date.now()}`;
    r.stream(command("run_across", id));
    await expect.poll(async () => Math.abs((await offsetX(page)) ?? 0), { timeout: 10_000 }).toBeGreaterThan(150);
    r.stream(command("run_across", id) + sse("sale.validated", { caseId: `E2E-INT-${Date.now()}`, userCode: "E2E-1", closerName: "Test Closer", validatedAt: new Date().toISOString(), source: "sse" }));
    await expect(cub(page)).toHaveAttribute("data-pose", "feeding", { timeout: 10_000 });
    expect(Math.abs((await offsetX(page)) ?? 0)).toBeLessThan(1); // back home before feeding
  });

  test("resizing the window mid-run stops safely and returns home, inside the new viewport", async ({ page }) => {
    const r = await rig(page);
    await r.open({ lastSaleAt: minsAgo(2), retry: 1500 });
    await expect(cub(page)).toBeVisible({ timeout: 15_000 });
    r.stream(command("run_across", `e2e-rs-${Date.now()}`)); // delivered on the next reconnect
    await expect.poll(async () => Math.abs((await offsetX(page)) ?? 0), { timeout: 15_000 }).toBeGreaterThan(150);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect.poll(async () => Math.abs((await offsetX(page)) ?? 0), { timeout: 3000 }).toBeLessThan(1);
    await expect(cub(page)).not.toHaveAttribute("data-pose", "run", { timeout: 3000 });
    const b = (await page.getByTestId("arena-cub-root").boundingBox())!;
    expect(b.x + b.width * 0.84).toBeLessThanOrEqual(1280);
  });
});
