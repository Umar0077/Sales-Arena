import { test, expect, type Page } from "@playwright/test";
import { sse } from "./cub-helpers";
import { TWO, display, openTeams } from "./teams-ui-helpers";

/**
 * Celebration sound package, run WITHOUT a database (playwright.ui.config.ts) on SIMULATED live events: the stream
 * delivers sale / award events shaped exactly like the server's, and the real app decides which sound plays. The
 * player records every decision in window.__celebrationSounds (played / muted / locked / duplicate / stopped), so
 * the tests check what was played, when and how often. They do not judge how the audio sounds.
 */
test.describe.configure({ timeout: 180_000 });

const TEAM = {
  sigma: { id: "team_sigma", slug: "sigma", name: "Team Sigma", active: true, logoUrl: "/teams/team-sigma.webp", hasLogo: true, color: "#8B5CF6", accentSecondary: null, businessDate: "2026-11-05" },
  panthers: { id: "team_panthers", slug: "panthers", name: "Team Panthers", active: true, logoUrl: "/teams/team-panthers.webp", hasLogo: true, color: "#A855F7", accentSecondary: null, businessDate: "2026-11-05" },
} as const;
const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
function sale(userCode: string, closer: string, team?: (typeof TEAM)[keyof typeof TEAM]) {
  const now = Date.now();
  const caseId = `SND-${now}-${seq++}`;
  return { caseId, text: sse("sale.validated", { caseId, userCode, closerName: closer, validatedAt: iso(now - 2500), source: "sse", firstSeenAt: iso(now - 300), storedAt: iso(now - 200), broadcastAt: iso(now - 100), ...(team ? { team } : {}) }) };
}
function award(userCode: string, name: string) {
  const now = Date.now();
  const a = {
    id: `snd-award-${now}-${seq++}`, programId: "ui-sr2", kind: "daily", agentId: `agt_${userCode}`, userCode, agentName: name, periodKey: "D:ui", n: 1, validatedAtAward: 2, amount: 2000, prizeLabel: "",
    programName: "FE Senior Daily 2", salesRequired: 2, rewardType: "cash", currency: "PKR", announce: true, createdAt: iso(now), upgrade: false, previousAmount: 0, incrementAmount: 2000,
  };
  return { id: a.id, text: sse("rewards.award.created", { award: a, validatedAt: iso(now - 2000), source: "sse", firstSeenAt: iso(now - 300), broadcastAt: iso(now) }) };
}
type Rec = { id: string; key?: string; result: string; at: number };
const sounds = (page: Page) => page.evaluate(() => (window as unknown as { __celebrationSounds?: Rec[] }).__celebrationSounds ?? []);
const playedIds = async (page: Page) => (await sounds(page)).filter((r) => r.result === "played").map((r) => r.id);
/** A person clicked the page: the app unlocks audio (browser autoplay policy). */
const allowAudio = async (page: Page) => {
  await page.mouse.click(5, 300);
  await page.waitForTimeout(500);
};
async function openScreen(page: Page, mode: string) {
  await page.goto(`/?screen=${mode}`);
  await expect(page.locator(`[data-arena-mode="${mode}"]`)).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1200);
}

test("the four sound files are served as WAV audio from public/audio/celebrations", async ({ request }) => {
  for (const f of ["sale-validated-chime", "sigma-lion-roar-victory", "panthers-big-cat-growl-victory", "cash-bonus-golden-ching"]) {
    const r = await request.get(`http://127.0.0.1:3100/audio/celebrations/${f}.wav`);
    expect(r.status(), f).toBe(200);
    expect(r.headers()["content-type"]).toMatch(/audio\/(wav|x-wav|wave)/);
    expect((await r.body()).subarray(0, 4).toString()).toBe("RIFF");
  }
});

for (const mode of ["daily", "weekly", "monthly"] as const) {
  test(`${mode}: a validated sale plays the sale chime once with its popup (stream redelivery never replays it)`, async ({ page }) => {
    const d = await display(page, { slugs: TWO });
    await openScreen(page, mode);
    await allowAudio(page);
    const s = sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma);
    d.stream(s.text, 2); // delivered, then redelivered after a reconnect
    await expect(page.getByText("SALE VALIDATED!")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(4000);
    const recs = await sounds(page);
    expect(recs.filter((r) => r.result === "played")).toEqual([expect.objectContaining({ id: "sale", key: `celeb_sale_${s.caseId}` })]);
    expect(recs.some((r) => r.id !== "sale")).toBe(false); // no team sound off Teams Arena
  });
}

test("Teams Arena: a Sigma sale plays the lion sound (and never the sale chime)", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  d.stream(sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma).text);
  await expect(page.getByTestId("team-celebration")).toHaveAttribute("data-theme", "lion", { timeout: 15_000 });
  await page.waitForTimeout(800);
  expect(await playedIds(page)).toEqual(["sigma"]);
  // the sound starts with the celebration (the roar enters at 0.2 s, under the emblem entrance)
  const rec = (await sounds(page)).find((r) => r.id === "sigma")!;
  const shownAt = await page.evaluate(() => performance.now());
  expect(shownAt - rec.at).toBeLessThan(1500);
});

test("Teams Arena: a Panthers sale plays the panther sound", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  d.stream(sale("UI-PANTHERS-0", "Syed Noroz Ali Kazmi", TEAM.panthers).text);
  await expect(page.getByTestId("team-celebration")).toHaveAttribute("data-theme", "panther", { timeout: 15_000 });
  await page.waitForTimeout(800);
  expect(await playedIds(page)).toEqual(["panthers"]);
});

test("cash bonus: the golden sound plays once with the popup; on Teams Arena the bonus sound comes first, then the team sound", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  const s = sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma);
  const a = award("UI-SIGMA-0", "Arsam Idrees");
  d.stream(s.text + a.text);
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(400);
  expect(await playedIds(page)).toEqual(["bonus"]);
  expect((await sounds(page)).find((r) => r.id === "bonus")!.key).toBe(a.id);
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  expect(await playedIds(page)).toEqual(["bonus", "sigma"]); // queue order, each once
});

test("Daily: a sale and its cash bonus each play their own sound once, the bonus following its popup", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openScreen(page, "daily");
  await allowAudio(page);
  d.stream(sale("UI-PANTHERS-1", "Hamna Nasir").text + award("UI-PANTHERS-1", "Hamna Nasir").text);
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(9000);
  const ids = await playedIds(page);
  expect(ids.filter((x) => x === "bonus")).toHaveLength(1);
  expect(ids.filter((x) => x === "sale")).toHaveLength(1);
  expect(ids.every((x) => x === "sale" || x === "bonus")).toBe(true);
});

test("mute: with Sound effects off nothing plays (the popups still appear)", async ({ page }) => {
  const d = await display(page, { slugs: TWO, values: { soundEnabled: false } });
  await openTeams(page, 2);
  await allowAudio(page);
  d.stream(sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma).text);
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  expect(await playedIds(page)).toEqual([]);
  expect((await sounds(page)).map((r) => r.result)).toEqual(["muted"]);
});

test("autoplay: before anyone clicked the page, sounds stay silent and are never replayed later", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openScreen(page, "daily");
  d.stream(sale("UI-SIGMA-0", "Arsam Idrees").text);
  await expect(page.getByText("SALE VALIDATED!")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  expect((await sounds(page)).map((r) => r.result)).toEqual(["locked"]);
  await allowAudio(page); // a later click does not play the old sale
  await page.waitForTimeout(800);
  expect(await playedIds(page)).toEqual([]);
});

test("page refresh never replays historical sounds; leaving Teams Arena stops the team sound (no orphaned audio)", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  d.stream(sale("UI-PANTHERS-0", "Syed Noroz Ali Kazmi", TEAM.panthers).text);
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.getByRole("tablist", { name: "Live Arena screen" }).getByRole("tab", { name: "Daily Arena" }).click();
  await expect(page.getByTestId("team-celebration")).toHaveCount(0);
  const recs = await sounds(page);
  expect(recs.map((r) => `${r.id}:${r.result}`)).toEqual(["panthers:played", "panthers:stopped"]);
  await page.reload();
  await expect(page.locator("[data-arena-mode]")).toBeVisible({ timeout: 120_000 });
  await allowAudio(page);
  await page.waitForTimeout(3000);
  expect(await sounds(page)).toEqual([]);
});

test("Spin & Win: no celebration sound plays on its own; its own sounds are untouched", async ({ page }) => {
  await display(page, { slugs: TWO });
  await openScreen(page, "spin");
  await allowAudio(page);
  await page.waitForTimeout(1500);
  expect(await sounds(page)).toEqual([]);
});
