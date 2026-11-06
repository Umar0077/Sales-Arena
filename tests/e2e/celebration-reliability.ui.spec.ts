import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { sse } from "./cub-helpers";
import { MONTH, TWO, display, openTeams } from "./teams-ui-helpers";

/**
 * Celebration reliability on a SIMULATED slow PC (database-free, playwright.ui.config.ts): Chromium CPU throttling
 * (DevTools Emulation.setCPUThrottlingRate) on the dev server, simulated live events on the stream, and the real
 * queues, popups and audio. In the page we record long main-thread tasks, frame pacing, how many full-screen popups
 * are on screen at once (sampled every 50 ms), the audio player's decisions and scheduling latency, and the queue
 * statistics. Numbers come from a throttled desktop browser running the DEVELOPMENT build: they show relative
 * behaviour under load, not exact real-device performance.
 */
test.describe.configure({ timeout: 240_000 });
const OUT = "playwright-report/reliability";
mkdirSync(OUT, { recursive: true });
const METRICS = `${OUT}/metrics.json`;

const TEAM = {
  sigma: { id: "team_sigma", slug: "sigma", name: "Team Sigma", active: true, logoUrl: "/teams/team-sigma.webp", hasLogo: true, color: "#8B5CF6", accentSecondary: null, businessDate: "2026-11-05" },
  panthers: { id: "team_panthers", slug: "panthers", name: "Team Panthers", active: true, logoUrl: "/teams/team-panthers.webp", hasLogo: true, color: "#A855F7", accentSecondary: null, businessDate: "2026-11-05" },
} as const;
const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
function sale(userCode: string, closer: string, team?: (typeof TEAM)[keyof typeof TEAM], caseId = `REL-${Date.now()}-${seq++}`) {
  const now = Date.now();
  return { caseId, text: sse("sale.validated", { caseId, userCode, closerName: closer, validatedAt: iso(now - 2500), source: "sse", firstSeenAt: iso(now - 300), storedAt: iso(now - 200), broadcastAt: iso(now - 100), ...(team ? { team } : {}) }) };
}
function award(userCode: string, name: string) {
  const now = Date.now();
  const a = {
    id: `rel-award-${now}-${seq++}`, programId: "ui-sr2", kind: "daily", agentId: `agt_${userCode}`, userCode, agentName: name, periodKey: "D:ui", n: 1, validatedAtAward: 2, amount: 2000, prizeLabel: "",
    programName: "FE Senior Daily 2", salesRequired: 2, rewardType: "cash", currency: "PKR", announce: true, createdAt: iso(now), upgrade: false, previousAmount: 0, incrementAmount: 2000,
  };
  return sse("rewards.award.created", { award: a, validatedAt: iso(now - 2000), source: "sse", firstSeenAt: iso(now - 300), broadcastAt: iso(now) });
}

/** In-page instruments (installed before the app runs). */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const perf = { longTasks: [] as number[], frames: [] as number[], overlaps: 0, maxStack: 0, order: [] as string[], motion: {} as Record<string, string> };
    w.__perf = perf;
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => perf.longTasks.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: true });
    } catch {
      /* not supported */
    }
    let last = 0;
    const f = (t: number) => {
      if (last) perf.frames.push(t - last);
      last = t;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
    let prev = "";
    setInterval(() => {
      const team = document.querySelector('[data-testid="team-celebration"]') as HTMLElement | null;
      const bonus = !!document.querySelector('[data-testid="bonus-popup"]');
      const n = (team ? 1 : 0) + (bonus ? 1 : 0);
      if (n > 1) perf.overlaps++;
      perf.maxStack = Math.max(perf.maxStack, n);
      if (team?.dataset.case && !perf.motion[team.dataset.case]) perf.motion[team.dataset.case] = team.dataset.motion ?? "";
      const now = team ? `team:${team.dataset.case}` : bonus ? "bonus" : "";
      if (now && now !== prev) perf.order.push(now);
      prev = now;
    }, 50);
    // Simulated tab visibility (the test flips it); everything else is the browser's own
    let vis: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => vis === "hidden" });
    w.__setVisibility = (v: DocumentVisibilityState) => {
      vis = v;
      document.dispatchEvent(new Event("visibilitychange"));
    };
  });
}
async function throttle(page: Page, rate: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}
const allowAudio = async (page: Page) => {
  await page.mouse.click(5, 300);
  await page.waitForTimeout(600);
};
type Snap = {
  perf: { longTasks: number[]; frames: number[]; overlaps: number; maxStack: number; order: string[]; motion: Record<string, string> };
  sounds: Array<{ id: string; key?: string; result: string; scheduleMs?: number; waitMs?: number }>;
  team: Record<string, number | string> | undefined;
  latency: Array<{ presentation?: string; stages: { browserToEnqueue: number | null; queueWait: number | null; browserToPopup: number | null } }>;
};
const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return { perf: w.__perf, sounds: w.__celebrationSounds ?? [], team: w.__teamCelebration, latency: w.__arenaLatency ?? [] } as Snap;
  });
/** Summarises one scenario and appends it to playwright-report/reliability/metrics.json. */
function record(name: string, rate: number, s: Snap) {
  const frames = s.perf.frames.filter((d) => d > 0 && d < 5000);
  const sorted = [...frames].sort((a, b) => a - b);
  const p = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0);
  const played = s.sounds.filter((x) => x.result === "played");
  const m = {
    scenario: name,
    cpuThrottle: `${rate}x`,
    frames: frames.length,
    avgFps: frames.length ? Math.round(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)) : 0,
    frameP95Ms: p(0.95),
    droppedFrames: frames.reduce((n, d) => n + Math.max(0, Math.round(d / 16.7) - 1), 0),
    longTasks: s.perf.longTasks.length,
    longTaskMaxMs: Math.max(0, ...s.perf.longTasks),
    popupOverlapSamples: s.perf.overlaps,
    maxPopupsOnScreen: s.perf.maxStack,
    soundsPlayed: played.map((x) => x.id).join(","),
    soundDuplicatesPlayed: played.length - new Set(played.map((x) => `${x.id}:${x.key}`)).size,
    audioScheduleMsMax: Math.max(0, ...played.map((x) => x.scheduleMs ?? 0)),
    audioWaitMsMax: Math.max(0, ...played.map((x) => x.waitMs ?? 0)),
    audioInterrupted: s.sounds.filter((x) => x.result === "interrupted").length,
    audioStopped: s.sounds.filter((x) => x.result === "stopped").length,
    queueWaitMsMax: Math.max(0, ...s.latency.filter((l) => l.presentation === "team").map((l) => l.stages.queueWait ?? 0)),
    teamQueue: s.team,
  };
  const all = existsSync(METRICS) ? JSON.parse(readFileSync(METRICS, "utf8")) : [];
  writeFileSync(METRICS, JSON.stringify([...all.filter((x: { scenario: string }) => x.scenario !== name), m], null, 1));
  console.log(`[metrics] ${JSON.stringify(m)}`);
  return m;
}
async function openDaily(page: Page) {
  await page.goto("/?screen=daily");
  await expect(page.locator('[data-arena-mode="daily"]')).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1200);
}
const playedIds = async (page: Page) => (await snap(page)).sounds.filter((r) => r.result === "played").map((r) => r.id);
const waitIdle = (page: Page, completed: number, timeout = 60_000) =>
  expect.poll(async () => (await snap(page)).team, { timeout }).toMatchObject({ completed, phase: "idle" });

test("1. normal sale on a slow PC (6x CPU): the card and the chime, once, scheduled promptly", async ({ page }) => {
  await instrument(page);
  const d = await display(page, { slugs: TWO });
  await openDaily(page);
  await allowAudio(page);
  await throttle(page, 6);
  d.stream(sale("UI-SIGMA-0", "Arsam Idrees").text);
  await expect(page.getByText("SALE VALIDATED!")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  expect(await playedIds(page)).toEqual(["sale"]);
  const m = record("normal sale chime", 6, await snap(page));
  expect(m.audioScheduleMsMax).toBeLessThan(250);
});

for (const [name, team, user, closer, id] of [
  ["2. Sigma", TEAM.sigma, "UI-SIGMA-0", "Arsam Idrees", "sigma"],
  ["3. Panthers", TEAM.panthers, "UI-PANTHERS-0", "Syed Noroz Ali Kazmi", "panthers"],
] as const) {
  test(`${name} celebration with 6x CPU throttling: plays, its sound plays once, it completes and the queue returns to idle`, async ({ page }) => {
    await instrument(page);
    const d = await display(page, { slugs: TWO, cub: true });
    await openTeams(page, 2);
    await allowAudio(page);
    await throttle(page, 6);
    d.stream(sale(user, closer, team).text);
    await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 20_000 });
    await waitIdle(page, 1);
    expect(await playedIds(page)).toEqual([id]);
    const m = record(`${name} celebration`, 6, await snap(page));
    expect(m.audioInterrupted + m.audioStopped).toBe(0);
    expect(m.maxPopupsOnScreen).toBe(1);
  });
}

test("4. a bonus arriving during a team celebration waits for it to finish and fade out, then shows with its sound", async ({ page }) => {
  await instrument(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  await throttle(page, 4);
  const s = sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma);
  d.stream(s.text);
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  d.stream(award("UI-SIGMA-0", "Arsam Idrees"));
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const m = record("bonus during team celebration", 4, await snap(page));
  expect(m.popupOverlapSamples).toBe(0);
  expect((await snap(page)).perf.order).toEqual([`team:celeb_sale_${s.caseId}`, "bonus"]);
  expect(await playedIds(page)).toEqual(["sigma", "bonus"]);
});

test("5. two validated sales within one second: both celebrated, in order, never stacked", async ({ page }) => {
  await instrument(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  await throttle(page, 4);
  const a = sale("UI-SIGMA-1", "Sahibzada Hassan Mehboob", TEAM.sigma);
  const b = sale("UI-PANTHERS-1", "Hamna Nasir", TEAM.panthers);
  d.stream(a.text + b.text);
  await waitIdle(page, 2, 90_000);
  const sn = await snap(page);
  expect(sn.perf.order).toEqual([`team:celeb_sale_${a.caseId}`, `team:celeb_sale_${b.caseId}`]);
  const m = record("two sales within a second", 4, sn);
  expect(m.popupOverlapSamples).toBe(0);
  expect(await playedIds(page)).toEqual(["sigma", "panthers"]);
});

test("6. five rapid sales: all five celebrated in arrival order, one at a time, each sound once", async ({ page }) => {
  await instrument(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  await throttle(page, 4);
  const sales = [0, 1, 2, 3, 4].map((i) => sale(i % 2 ? "UI-PANTHERS-2" : "UI-SIGMA-2", `Closer ${i}`, i % 2 ? TEAM.panthers : TEAM.sigma));
  d.stream(sales.map((x) => x.text).join(""));
  await waitIdle(page, 5, 150_000);
  const sn = await snap(page);
  expect(sn.perf.order).toEqual(sales.map((x) => `team:celeb_sale_${x.caseId}`));
  expect(await playedIds(page)).toEqual(["sigma", "panthers", "sigma", "panthers", "sigma"]);
  const m = record("five rapid sales", 4, sn);
  expect(m.popupOverlapSamples).toBe(0);
  expect(sn.team).toMatchObject({ queued: 5, started: 5, completed: 5, duplicates: 0 });
});

test("7 + 8. sale and bonus at the same moment under load: bonus first, its fade-out completes, then the team celebration (no overlap)", async ({ page }) => {
  await instrument(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  await throttle(page, 6);
  const s = sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma);
  d.stream(s.text + award("UI-SIGMA-0", "Arsam Idrees"));
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 30_000 });
  await waitIdle(page, 1, 90_000);
  const sn = await snap(page);
  expect(sn.perf.order).toEqual(["bonus", `team:celeb_sale_${s.caseId}`]);
  const m = record("sale + bonus together (bonus fade-out then team)", 6, sn);
  expect(m.popupOverlapSamples).toBe(0);
  expect(await playedIds(page)).toEqual(["bonus", "sigma"]);
});

test("10 + 19. stream redelivery and a page refresh: one celebration, one sound, nothing replayed after reload", async ({ page }) => {
  await instrument(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  const s = sale("UI-PANTHERS-0", "Syed Noroz Ali Kazmi", TEAM.panthers);
  d.stream(s.text, 3);
  await waitIdle(page, 1);
  await page.waitForTimeout(4000); // reconnects redeliver the same case
  const sn = await snap(page);
  expect(sn.team).toMatchObject({ started: 1, completed: 1 });
  expect(await playedIds(page)).toEqual(["panthers"]);
  record("duplicates (stream redelivery)", 1, sn);
  await page.reload();
  await expect(page.getByTestId("team-card")).toHaveCount(2, { timeout: 120_000 });
  await allowAudio(page);
  await page.waitForTimeout(3000);
  expect((await snap(page)).sounds).toEqual([]);
});

test("11. tab hidden: no celebration starts while hidden (nothing dropped); shown again, it plays and completes", async ({ page }) => {
  await instrument(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  await page.evaluate(() => (window as unknown as { __setVisibility: (v: string) => void }).__setVisibility("hidden"));
  d.stream(sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma).text);
  await page.waitForTimeout(4000);
  await expect(page.getByTestId("team-celebration")).toHaveCount(0);
  expect((await snap(page)).team).toMatchObject({ queued: 1, started: 0 });
  await page.evaluate(() => (window as unknown as { __setVisibility: (v: string) => void }).__setVisibility("visible"));
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 10_000 });
  // hidden again mid-celebration past its end: shown again, it ends at once instead of running late
  await page.evaluate(() => (window as unknown as { __setVisibility: (v: string) => void }).__setVisibility("hidden"));
  await page.waitForTimeout(6500);
  await page.evaluate(() => (window as unknown as { __setVisibility: (v: string) => void }).__setVisibility("visible"));
  await waitIdle(page, 1, 10_000);
  record("tab hidden and restored", 1, await snap(page));
});

test("12. audio context suspended mid-sound: the sound stops for good and is never replayed after resume", async ({ page }) => {
  await instrument(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  d.stream(sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma).text);
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const ctx = (window as unknown as { Howler: { ctx: AudioContext } }).Howler?.ctx;
    await ctx.suspend();
    await new Promise((r) => setTimeout(r, 800));
    await ctx.resume();
  });
  await page.waitForTimeout(1500);
  const sn = await snap(page);
  expect(sn.sounds.map((x) => x.result)).toEqual(["played", "interrupted"]);
  record("audio context suspended and resumed", 1, sn);
  await waitIdle(page, 1);
});

test("15. slow artwork (2.5 s to load): the celebration still starts within its preparation limit and completes", async ({ page }) => {
  await instrument(page);
  await page.route("**/teams/celebrations/*.webp", async (r) => {
    await new Promise((res) => setTimeout(res, 2500));
    await r.continue();
  });
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  const t0 = Date.now();
  d.stream(sale("UI-PANTHERS-0", "Syed Noroz Ali Kazmi", TEAM.panthers).text);
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 20_000 });
  const startedAfter = Date.now() - t0;
  await expect(page.getByTestId("team-emblem-img")).toHaveJSProperty("complete", true, { timeout: 10_000 });
  await waitIdle(page, 1);
  record("slow artwork loading", 1, await snap(page));
  expect(startedAfter).toBeLessThan(3500); // stream delivery + at most the 0.8 s preparation wait, not the 2.5 s load
});

test("16. leaderboard / standings updates during a celebration never restart it or touch its sound", async ({ page }) => {
  await instrument(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  d.stream(sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma).text);
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("team-celebration").evaluate((e) => ((e as HTMLElement).dataset.marker = "same"));
  d.st.figs = { ...MONTH, sigma: [[9, 12], ...MONTH.sigma.slice(1)] };
  d.stream(sse("teams.updated", { reason: "test" }) + sse("stats.updated", {}), 2);
  await expect(page.locator('[data-testid="member-row"][data-user="UI-SIGMA-0"] [data-testid="member-validated"]')).toHaveText("9", { timeout: 15_000 });
  await expect(page.getByTestId("team-celebration")).toHaveAttribute("data-marker", "same");
  await waitIdle(page, 1);
  const sn = await snap(page);
  expect(sn.sounds.map((x) => x.result)).toEqual(["played"]);
  record("standings updates during a celebration", 1, sn);
});

test("14 + measured Lite: on a very slow PC (10x) the display measures poor frame pacing and switches later celebrations to Lite", async ({ page }) => {
  test.setTimeout(330_000);
  // Needs the production build (playwright.perf.config.ts): the development server at 10x draws no frames at all
  // during a celebration, so there is nothing to measure there.
  test.skip(test.info().project.use.baseURL?.includes(":3100") === true, "measured on the production build only");
  await instrument(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await allowAudio(page);
  await throttle(page, 10);
  const sales = [0, 1, 2].map((i) => sale("UI-SIGMA-3", `Closer ${i}`, TEAM.sigma));
  d.stream(sales.map((x) => x.text).join(""));
  await waitIdle(page, 3, 220_000);
  // the first celebrations ran Full and measured poor pacing; the last one switched to Lite (still the same emblem,
  // headline, closer and sound)
  const motion = (await snap(page)).perf.motion;
  console.log(`[metrics] measured celebration fps at 10x: ${(await page.evaluate(() => (window as unknown as { __celebrationFrames: Array<{ avgFps: number; samples: number }> }).__celebrationFrames.map((f) => `${Math.round(f.avgFps)}fps/${f.samples}`))).join(", ")}; motion ${JSON.stringify(Object.values(motion))}`);
  expect(motion[`celeb_sale_${sales[0].caseId}`]).toBe("full");
  expect(motion[`celeb_sale_${sales[2].caseId}`]).toBe("lite");
  const frames = await page.evaluate(() => (window as unknown as { __celebrationFrames: Array<{ avgFps: number }> }).__celebrationFrames.map((f) => Math.round(f.avgFps)));
  console.log(`[metrics] measured celebration fps at 10x: ${frames.join(", ")}`);
  expect(await playedIds(page)).toEqual(["sigma", "sigma", "sigma"]); // Lite keeps the sound
  record("very slow PC (measured Lite)", 10, await snap(page));
});

test("17 + 18. Arena Cub + celebrations while switching Teams / Daily / Weekly / Monthly: nothing stuck, nothing lost, no orphaned audio", async ({ page }) => {
  await instrument(page);
  const d = await display(page, { slugs: TWO, cub: true });
  await openTeams(page, 2);
  await allowAudio(page);
  await throttle(page, 4);
  await expect(page.getByTestId("arena-cub")).toBeVisible({ timeout: 30_000 });
  const a = sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma);
  const b = sale("UI-PANTHERS-0", "Syed Noroz Ali Kazmi", TEAM.panthers);
  d.stream(a.text + b.text);
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 20_000 });
  const tabs = page.getByRole("tablist", { name: "Live Arena screen" });
  for (const tab of ["Daily Arena", "Weekly Arena", "Monthly Arena", "Teams Arena"]) {
    await tabs.getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(6000);
  const sn = await snap(page);
  // Nothing stuck; each sale presented exactly once. The second sale was either waiting when Teams Arena closed
  // (handed to the standard sale card) or arrived after it closed (routed straight to the standard card): both
  // mean one standard card with one chime, never a lost or doubled notification.
  expect(sn.team).toMatchObject({ phase: "idle" });
  const playedKeys = sn.sounds.filter((x) => x.result === "played").map((x) => `${x.id}:${x.key}`);
  console.log(`[metrics] screen-switch sounds ${JSON.stringify(playedKeys)} queue ${JSON.stringify(sn.team)}`);
  expect(playedKeys[0]).toBe(`sigma:celeb_sale_${a.caseId}`);
  // the second sale: exactly once, as its own team celebration (if it had started before the switch) or as one
  // standard sale card (handed back / routed after the switch)
  const second = playedKeys.filter((k) => k.endsWith(`:celeb_sale_${b.caseId}`));
  expect(second).toHaveLength(1);
  expect(["panthers", "sale"]).toContain(second[0].split(":")[0]);
  expect(playedKeys).toHaveLength(2);
  expect(await page.evaluate(() => (window as unknown as { __celebrationAudio: { active: number } }).__celebrationAudio.active)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("arena-cub")).toBeVisible();
  const m = record("Arena Cub + screen switching", 4, sn);
  expect(m.maxPopupsOnScreen).toBeLessThanOrEqual(1);
});

for (const rate of [1, 4, 6, 10]) {
  test(`sweep ${rate}x: sale + cash bonus + a second team sale complete in queue order, each sound once, never stacked`, async ({ page }) => {
    test.setTimeout(360_000);
    await instrument(page);
    const d = await display(page, { slugs: TWO, cub: true });
    await openTeams(page, 2);
    await allowAudio(page);
    if (rate > 1) await throttle(page, rate);
    const a = sale("UI-SIGMA-0", "Arsam Idrees", TEAM.sigma);
    const b = sale("UI-PANTHERS-0", "Syed Noroz Ali Kazmi", TEAM.panthers);
    d.stream(a.text + award("UI-SIGMA-0", "Arsam Idrees") + b.text);
    await waitIdle(page, 2, 300_000);
    const sn = await snap(page);
    expect(sn.perf.order).toEqual(["bonus", `team:celeb_sale_${a.caseId}`, `team:celeb_sale_${b.caseId}`]);
    expect(await playedIds(page)).toEqual(["bonus", "sigma", "panthers"]);
    const m = record(`sweep ${rate}x (sale + bonus + sale)`, rate, sn);
    expect(m.popupOverlapSamples).toBe(0);
    expect(m.soundDuplicatesPlayed).toBe(0);
    console.log(`[metrics] sweep ${rate}x lite=${JSON.stringify(sn.perf.motion)}`);
  });
}
