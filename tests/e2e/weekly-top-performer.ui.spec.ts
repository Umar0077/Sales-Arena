import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { sse } from "./cub-helpers";
import { TWO, display, openTeams } from "./teams-ui-helpers";
import { installSoundRecorder, playedSounds } from "./sound-recorder";

/**
 * Weekly Top Performer ceremony on the Live Arena, WITHOUT a database (playwright.ui.config.ts): the stream delivers
 * the server's "arena.recognition.weekly_top" event (as the Admin button publishes it); the queue, the ceremony, the
 * confetti and the sound are the real app. The Admin side (once per week, server-side #1) is covered by
 * tests/integration/weekly-top.test.ts.
 */
test.describe.configure({ timeout: 180_000 });
const SHOTS = "playwright-report/weekly-top";
mkdirSync(SHOTS, { recursive: true });
const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;

function ceremony(name = "Arsam Idrees", validated = 23) {
  const id = `weekly-top:2026-11-02-${seq++}`;
  return { id, text: sse("arena.recognition.weekly_top", { id, from: "2026-11-02", to: "2026-11-08", label: "This Week · Nov 2 – Nov 8, 2026", userCode: "UI-SIGMA-0", name, validated, at: iso(Date.now()) }) };
}
function award(userCode: string, name: string) {
  const now = Date.now();
  const a = {
    id: `wtp-award-${now}-${seq++}`, programId: "ui-sr2", kind: "daily", agentId: `agt_${userCode}`, userCode, agentName: name, periodKey: "D:ui", n: 1, validatedAtAward: 2, amount: 2000, prizeLabel: "",
    programName: "FE Senior Daily 2", salesRequired: 2, rewardType: "cash", currency: "PKR", announce: true, createdAt: iso(now), upgrade: false, previousAmount: 0, incrementAmount: 2000,
  };
  return sse("rewards.award.created", { award: a, validatedAt: iso(now - 2000), source: "sse", firstSeenAt: iso(now - 300), broadcastAt: iso(now) });
}
const allowAudio = async (page: Page) => {
  await page.mouse.click(5, 300);
  await page.waitForTimeout(500);
};
async function openScreen(page: Page, mode: string) {
  await page.goto(`/?screen=${mode}`);
  await expect(page.locator(`[data-arena-mode="${mode}"]`)).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1200);
}
const played = async (page: Page) => (await playedSounds(page)).filter((n) => n !== "other:0.1s");
test.beforeEach(async ({ page }) => installSoundRecorder(page));

for (const mode of ["daily", "weekly", "monthly", "teams"] as const) {
  test(`${mode}: the ceremony shows CONGRATULATIONS!, the top performer and their approved sales, plays the trumpet once, closes by itself`, async ({ page }) => {
    const d = await display(page, { slugs: TWO });
    if (mode === "teams") await openTeams(page, 2);
    else await openScreen(page, mode);
    await allowAudio(page);
    const c = ceremony();
    d.stream(c.text, 2); // delivered, then redelivered after a reconnect: still one ceremony
    const el = page.getByTestId("weekly-top-celebration");
    await expect(el).toBeVisible({ timeout: 15_000 });
    await expect(el).toHaveAttribute("data-case", `recognition_${c.id}`);
    await expect(page.getByTestId("weekly-top-headline")).toHaveText("CONGRATULATIONS!");
    await expect(page.getByTestId("weekly-top-kicker")).toHaveText("THIS WEEK'S TOP PERFORMER");
    await expect(page.getByTestId("weekly-top-name")).toHaveText("Arsam Idrees");
    await expect(page.getByTestId("weekly-top-sales")).toHaveText(/23\s*approved sales/i);
    await expect(page.getByTestId("weekly-top-week")).toHaveText("This Week · Nov 2 – Nov 8, 2026");
    await page.waitForTimeout(2600);
    if (mode === "daily" || mode === "teams") await page.screenshot({ path: `${SHOTS}/${mode}-1920x1080.png` });
    await expect(el).toBeHidden({ timeout: 15_000 }); // ends on its own (~9.5 s)
    await page.waitForTimeout(3500); // the redelivered event must not start a second ceremony
    await expect(el).toHaveCount(0);
    expect(await played(page)).toEqual(["bonus"]); // the trumpet celebration, once
    const log = await page.evaluate(() => (window as unknown as { __celebrationSounds: Array<{ key?: string; result: string }> }).__celebrationSounds.filter((r) => r.result === "played"));
    expect(log.map((r) => r.key)).toEqual([`recognition_${c.id}`]);
  });
}

test("a bonus popup already on screen goes first; the ceremony follows; they never overlap", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openScreen(page, "daily");
  await allowAudio(page);
  await page.addInitScript(() => {});
  const overlap = await page.evaluateHandle(() => {
    const st = { both: 0, order: [] as string[] };
    let prev = "";
    setInterval(() => {
      const c = !!document.querySelector('[data-testid="weekly-top-celebration"]');
      const b = !!document.querySelector('[data-testid="bonus-popup"]');
      if (c && b) st.both++;
      const now = c ? "ceremony" : b ? "bonus" : "";
      if (now && now !== prev) st.order.push(now);
      prev = now;
    }, 50);
    return st;
  });
  d.stream(award("UI-SIGMA-1", "Sahibzada Hassan Mehboob") + ceremony("Sahibzada Hassan Mehboob", 19).text);
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("weekly-top-celebration")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("weekly-top-celebration")).toBeHidden({ timeout: 20_000 });
  const st = await overlap.jsonValue();
  expect(st.both).toBe(0);
  expect(st.order).toEqual(["bonus", "ceremony"]);
});

test("a sale arriving during the ceremony waits for it (one popup at a time), then shows normally", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openScreen(page, "weekly");
  await allowAudio(page);
  d.stream(ceremony().text);
  await expect(page.getByTestId("weekly-top-celebration")).toBeVisible({ timeout: 15_000 });
  const now = Date.now();
  d.stream(sse("sale.validated", { caseId: `WTP-${now}`, userCode: "UI-PANTHERS-1", closerName: "Hamna Nasir", validatedAt: iso(now - 2000), source: "sse", firstSeenAt: iso(now - 300), storedAt: iso(now - 200), broadcastAt: iso(now - 100) }));
  await page.waitForTimeout(2500);
  await expect(page.getByText("SALE VALIDATED!")).toHaveCount(0); // not on top of the ceremony
  await expect(page.getByTestId("weekly-top-celebration")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText("SALE VALIDATED!")).toBeVisible({ timeout: 10_000 });
});

test("reduced motion: the still composition with the same text; 1366×768 fits", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await installSoundRecorder(page);
  const d = await display(page, { slugs: TWO, cub: false });
  await openScreen(page, "daily");
  d.stream(ceremony("Syed Noroz Ali Kazmi", 1).text);
  const el = page.getByTestId("weekly-top-celebration");
  await expect(el).toHaveAttribute("data-motion", "static", { timeout: 15_000 });
  await expect(page.getByTestId("weekly-top-sales")).toHaveText(/1\s*approved sale$/i);
  await page.waitForTimeout(1200);
  const fit = await page.evaluate(() => {
    const ids = ["weekly-top-headline", "weekly-top-name", "weekly-top-sales", "weekly-top-week"];
    return ids.every((id) => {
      const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    });
  });
  expect(fit).toBe(true);
  await page.screenshot({ path: `${SHOTS}/reduced-1366x768.png` });
  await ctx.close();
});
