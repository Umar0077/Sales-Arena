import { test, expect, type Page } from "@playwright/test";
import { sse } from "./cub-helpers";
import { TWO, display, openTeams } from "./teams-ui-helpers";
import { installSoundRecorder, playedSounds } from "./sound-recorder";

/**
 * Celebration sounds, run WITHOUT a database (playwright.ui.config.ts) on SIMULATED live events (shaped exactly like
 * the server's). What plays is observed from outside the app (tests/e2e/sound-recorder.ts):
 *  - validated sale → the ORIGINAL engine "sale" sound; Team Sigma / Panthers → the ORIGINAL stingers;
 *  - cash bonus → the Owner's trumpet celebration (public/audio/celebrations/cash-bonus-trumpet.wav).
 * The tests check what played, when and how often; they do not judge how it sounds.
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
type Rec = { id: string; key?: string; result: string };
/** The bonus player's decisions. "duplicate" entries are React's development double-mount asking twice for the same
 *  popup (the player refuses the repeat, which is the protection under test); actual playback is checked by played(). */
const bonusLog = async (page: Page) => (await page.evaluate(() => (window as unknown as { __celebrationSounds?: Rec[] }).__celebrationSounds ?? [])).filter((r) => r.result !== "duplicate");
/** Notification sounds only (interface clicks on the screen selector are not notifications). */
const played = async (page: Page) => (await playedSounds(page)).filter((n) => n !== "other:0.1s");
const allowAudio = async (page: Page) => {
  await page.mouse.click(5, 300); // a person clicked the page: the app unlocks audio (browser autoplay policy)
  await page.waitForTimeout(500);
};
async function openScreen(page: Page, mode: string) {
  await page.goto(`/?screen=${mode}`);
  await expect(page.locator(`[data-arena-mode="${mode}"]`)).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1200);
}
test.beforeEach(async ({ page }) => installSoundRecorder(page));

test("only the cash bonus trumpet file is served; the old synthesized package files are gone", async ({ request }) => {
  const r = await request.get("http://127.0.0.1:3100/audio/celebrations/cash-bonus-trumpet.wav");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toMatch(/audio\/(wav|x-wav|wave)/);
  expect((await r.body()).subarray(0, 4).toString()).toBe("RIFF");
  for (const f of ["sale-validated-chime", "sigma-lion-roar-victory", "panthers-big-cat-growl-victory", "cash-bonus-golden-ching"])
    expect((await request.get(`http://127.0.0.1:3100/audio/celebrations/${f}.wav`)).status(), f).toBe(404);
});

for (const mode of ["daily", "weekly", "monthly"] as const) {
  test(`${mode}: a validated sale plays the ORIGINAL sale sound once with its popup (stream redelivery never replays it)`, async ({ page }) => {
    const d = await display(page, { slugs: TWO });
    await openScreen(page, mode);
    await allowAudio(page);
    d.stream(sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma).text, 2); // delivered, then redelivered after a reconnect
    await expect(page.getByText("SALE VALIDATED!")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(4000);
    expect(await played(page)).toEqual(["sale"]);
  });
}

test("Teams Arena: a Sigma sale plays the ORIGINAL Sigma sound (and never the sale sound)", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  d.stream(sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma).text);
  await expect(page.getByTestId("team-celebration")).toHaveAttribute("data-theme", "lion", { timeout: 15_000 });
  await page.waitForTimeout(1500);
  expect(await played(page)).toEqual(["sigma"]);
  expect(await page.evaluate(() => document.documentElement.dataset.teamStinger)).toBe("played");
});

test("Teams Arena: a Panthers sale plays the ORIGINAL Panthers sound", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  d.stream(sale("UI-PANTHERS-0", "Syed Noroz Ali Kazmi", TEAM.panthers).text);
  await expect(page.getByTestId("team-celebration")).toHaveAttribute("data-theme", "panther", { timeout: 15_000 });
  await page.waitForTimeout(1500);
  expect(await played(page)).toEqual(["panthers"]);
});

test("cash bonus: the trumpet plays once with its popup; on Teams Arena the bonus comes first, then the team sound", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  const a = award("UI-SIGMA-0", "Arsam Idrees");
  d.stream(sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma).text + a.text);
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  expect(await played(page)).toEqual(["bonus"]);
  expect((await bonusLog(page)).find((r) => r.result === "played")!.key).toBe(a.id);
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  expect(await played(page)).toEqual(["bonus", "sigma"]); // queue order, each once
});

test("Daily: a sale and its cash bonus each play their own sound once (original sale sound, then the trumpet)", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openScreen(page, "daily");
  await allowAudio(page);
  d.stream(sale("UI-PANTHERS-1", "Hamna Nasir").text + award("UI-PANTHERS-1", "Hamna Nasir").text);
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(9000);
  expect(await played(page)).toEqual(["sale", "bonus"]);
});

test("a bonus popup closed early: the trumpet fades out (no hard cut, nothing carried into the next popup)", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openScreen(page, "daily");
  await allowAudio(page);
  d.stream(award("UI-SIGMA-1", "Sahibzada Hassan Mehboob").text);
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.getByTestId("bonus-popup").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("bonus-popup")).toHaveCount(0);
  await expect.poll(async () => (await bonusLog(page)).map((r) => r.result), { timeout: 5000 }).toEqual(["played", "stopped"]);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { __celebrationAudio: { active: number } }).__celebrationAudio.active)).toBe(0);
});

test("mute: with Sound effects off nothing plays (the popups still appear)", async ({ page }) => {
  const d = await display(page, { slugs: TWO, values: { soundEnabled: false } });
  await openTeams(page, 2);
  await allowAudio(page);
  d.stream(sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma).text + award("UI-SIGMA-0", "Arsam Idrees").text);
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  expect(await played(page)).toEqual([]);
  expect((await bonusLog(page)).map((r) => r.result)).toEqual(["muted"]);
});


test("page refresh never replays historical sounds; screen switching leaves no team sound running", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  d.stream(sale("UI-PANTHERS-0", "Syed Noroz Ali Kazmi", TEAM.panthers).text);
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.getByRole("tablist", { name: "Live Arena screen" }).getByRole("tab", { name: "Daily Arena" }).click();
  await expect(page.getByTestId("team-celebration")).toHaveCount(0);
  expect(await played(page)).toEqual(["panthers"]);
  await page.reload();
  await expect(page.locator("[data-arena-mode]")).toBeVisible({ timeout: 120_000 });
  await allowAudio(page);
  await page.waitForTimeout(3000);
  expect(await played(page)).toEqual([]);
});

test("Spin & Win: no celebration sound plays on its own; its own sounds are untouched", async ({ page }) => {
  await display(page, { slugs: TWO });
  await openScreen(page, "spin");
  await allowAudio(page);
  await page.waitForTimeout(1500);
  expect(await played(page)).toEqual([]);
});

test("root cause: after 35 s of silence (Howler used to suspend audio after 30 s) a Sigma sale and a cash bonus still play", async ({ page }) => {
  test.setTimeout(240_000);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  await page.waitForTimeout(35_000); // an office TV idle between sales
  expect(await page.evaluate(() => (window as unknown as { Howler: { ctx: AudioContext } }).Howler.ctx.state)).toBe("running");
  d.stream(sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma).text);
  await expect(page.getByTestId("team-celebration")).toHaveAttribute("data-theme", "lion", { timeout: 15_000 });
  await page.waitForTimeout(1500);
  expect(await played(page)).toEqual(["sigma"]);
  const a = award("UI-PANTHERS-0", "Syed Noroz Ali Kazmi");
  d.stream(a.text);
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  expect(await played(page)).toEqual(["sigma", "bonus"]);
});

test("a context the device suspended is resumed before the next team sound and trumpet (no new click needed)", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  await page.evaluate(() => (window as unknown as { Howler: { ctx: AudioContext } }).Howler.ctx.suspend());
  d.stream(sale("UI-PANTHERS-0", "Syed Noroz Ali Kazmi", TEAM.panthers).text);
  await expect(page.getByTestId("team-celebration")).toHaveAttribute("data-theme", "panther", { timeout: 15_000 });
  await page.waitForTimeout(1500);
  expect(await played(page)).toEqual(["panthers"]);
});

test("Admin sound test on a display: one short test sound and a real acknowledgement; skipped when muted / locked; never a popup", async ({ browser }) => {
  for (const [values, click, expectPlayed, reason] of [
    [{}, true, true, /scheduled/],
    [{ soundEnabled: false }, true, false, /Muted/],
    [{}, false, true, /scheduled/], // this browser allows autoplay: no click needed since the fix
  ] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installSoundRecorder(page);
    const acks: Array<{ id: string; result: { played: boolean; reason: string; readiness: string } }> = [];
    await page.route("**/api/arena/sound-test", async (r) => {
      acks.push(JSON.parse(r.request().postData() ?? "{}"));
      await r.fulfill({ json: { ok: true } });
    });
    const d = await display(page, { slugs: TWO, values });
    await openScreen(page, "daily");
    if (click) await allowAudio(page);
    const id = `st_ui_${Date.now()}`;
    d.stream(sse("arena.sound.test", { id, target: { scope: "all" } }), 2); // redelivered: still once
    await expect.poll(() => acks.length, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(1000);
    expect(acks.length).toBe(1);
    expect(acks[0].id).toBe(id);
    expect(acks[0].result.played).toBe(expectPlayed);
    expect(acks[0].result.reason).toMatch(reason);
    expect(await played(page)).toEqual(expectPlayed ? ["sale"] : []);
    await expect(page.getByText("SALE VALIDATED!")).toHaveCount(0);
    await ctx.close();
  }
});
