import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { sse } from "./cub-helpers";
import { MONTH, TWO, display, errorsOf, openTeams, type Figs } from "./teams-ui-helpers";

/**
 * Teams Arena team-sale celebrations, run WITHOUT a database (playwright.ui.config.ts). The live stream, the
 * background sync answer, settings and standings come from the test; routing, queues, popups, mascots, crests,
 * sounds and the other screens are the real application. Nothing is written anywhere.
 */
test.describe.configure({ timeout: 180_000 });
const SHOTS = "playwright-report/team-celebration";
mkdirSync(SHOTS, { recursive: true });

const TEAM = {
  sigma: { id: "team_sigma", slug: "sigma", name: "Team Sigma", active: true, logoUrl: "/teams/team-sigma.webp", hasLogo: true, color: "#8B5CF6", accentSecondary: null, businessDate: "2026-11-05" },
  panthers: { id: "team_panthers", slug: "panthers", name: "Team Panthers", active: true, logoUrl: "/teams/team-panthers.webp", hasLogo: true, color: "#A855F7", accentSecondary: null, businessDate: "2026-11-05" },
  alpha: { id: "team_alpha", slug: "alpha", name: "Team Alpha", active: false, logoUrl: "/teams/team-alpha.webp", hasLogo: true, color: "#22D3FF", accentSecondary: null, businessDate: "2026-11-05" },
  falcons: { id: "team_falcons", slug: "falcons", name: "Team Falcons", active: true, logoUrl: null, hasLogo: false, color: "#34D399", accentSecondary: null, businessDate: "2026-11-05" },
} as const;

const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
/** A genuine committed sale as the server publishes it (with its team attribution, or `team` left out / null). */
function saleEvent(o: { caseId?: string; userCode: string; closer: string; team?: (typeof TEAM)[keyof typeof TEAM] | null; omitTeam?: boolean }) {
  const now = Date.now();
  const caseId = o.caseId ?? `TC-${now}-${seq++}`;
  const payload: Record<string, unknown> = { caseId, userCode: o.userCode, closerName: o.closer, validatedAt: iso(now - 2500), source: "sse", firstSeenAt: iso(now - 300), storedAt: iso(now - 200), broadcastAt: iso(now - 100) };
  if (!o.omitTeam) payload.team = o.team ?? null;
  return { caseId, text: sse("sale.validated", payload) };
}

/** Counts what the screen shows over time (sampled every 50 ms in the page). */
async function watch(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const seen = new Set<string>();
    w.__tc = { cardNames: [] as string[], cases: [] as string[], cards: 0, maxTeam: 0, overlapBonus: 0, overlapCard: 0, bonus: 0, themes: [] as string[] };
    let card = false;
    let bonus = false;
    setInterval(() => {
      const tc = w.__tc as { cardNames: string[]; cases: string[]; cards: number; maxTeam: number; overlapBonus: number; overlapCard: number; bonus: number; themes: string[] };
      const els = [...document.querySelectorAll('[data-testid="team-celebration"]')] as HTMLElement[];
      tc.maxTeam = Math.max(tc.maxTeam, els.filter((e) => getComputedStyle(e).opacity !== "0").length);
      for (const e of els) {
        const id = e.dataset.case ?? "";
        if (!seen.has(id)) {
          seen.add(id);
          tc.cases.push(id);
          tc.themes.push(e.dataset.theme ?? "");
        }
      }
      const text = document.body?.innerText ?? "";
      const c = text.includes("SALE VALIDATED!");
      // Standard cards, counted per closer (consecutive cards keep the same "SALE VALIDATED!" title).
      for (const m of text.matchAll(/([^\n·]+?) · \+1 Validated Sale/g)) if (!tc.cardNames.includes(m[1].trim())) tc.cardNames.push(m[1].trim());
      const b = !!document.querySelector('[data-testid="bonus-popup"]');
      if (c && !card) tc.cards++;
      if (b && !bonus) tc.bonus++;
      if (els.length && b) tc.overlapBonus++;
      if (els.length && c) tc.overlapCard++;
      card = c;
      bonus = b;
    }, 50);
  });
}
type Tc = { cases: string[]; cards: number; maxTeam: number; overlapBonus: number; overlapCard: number; bonus: number; themes: string[] };
const tc = (page: Page) => page.evaluate(() => (window as unknown as { __tc: Tc }).__tc);
const cardNames = (page: Page) => page.evaluate(() => (window as unknown as { __tc: { cardNames: string[] } }).__tc.cardNames);

async function openScreen(page: Page, mode: "daily" | "weekly" | "monthly" | "spin") {
  await page.goto(`/?screen=${mode}`);
  await expect(page.locator(`[data-arena-mode="${mode}"]`)).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1200); // the live stream is open
}

test("Sigma sale on Teams Arena → golden lion, official Sigma crest, real closer, verified total; no sale card on top", async ({ page }) => {
  const errors = errorsOf(page);
  await watch(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await page.waitForTimeout(1200);
  // The sale is committed upstream: Sigma's first member now has one more validated sale.
  const after: Figs = { ...MONTH, sigma: [[5, 8], ...MONTH.sigma.slice(1)] };
  const s = saleEvent({ userCode: "UI-SIGMA-0", closer: "Arsam Idrees", team: TEAM.sigma });
  d.st.figs = after;
  d.stream(s.text + sse("teams.updated", { reason: "test" }));
  const cel = page.getByTestId("team-celebration");
  await expect(cel).toBeVisible({ timeout: 15_000 });
  await expect(cel).toHaveAttribute("data-theme", "lion");
  await expect(cel).toHaveAttribute("data-team-id", "team_sigma");
  await expect(cel).toHaveAttribute("data-case", `celeb_sale_${s.caseId}`);
  await expect(page.getByTestId("team-celebration-headline")).toHaveAttribute("data-headline", "TEAM SIGMA GOT A SALE!");
  await expect(page.getByTestId("team-celebration-headline")).toHaveText(/TEAM\s+SIGMA\s+GOT\s+A\s+SALE!/);
  await expect(page.getByTestId("team-celebration-agent")).toHaveText("Arsam Idrees");
  await expect(page.getByTestId("team-emblem")).toHaveAttribute("data-emblem", "lion");
  await expect(page.getByTestId("team-emblem-img")).toHaveAttribute("src", "/teams/celebrations/sigma-lion-emblem.webp");
  expect(await page.getByTestId("team-emblem-img").evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(1600); // the Owner's artwork loaded
  await expect(cel.getByTestId("team-celebration-crest")).toHaveAttribute("src", "/teams/team-sigma.webp");
  // Verified total: appears only once the standings refreshed past the figure at arrival.
  await expect(page.getByTestId("team-celebration-total")).toContainText("Team Sigma");
  await expect(page.getByTestId("team-celebration-total")).toContainText(/\b\d+\b validated/);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${SHOTS}/sigma-lion-1920x1080.png` });
  await expect(cel).toBeHidden({ timeout: 10_000 });
  const t = await tc(page);
  expect(t.cases).toEqual([`celeb_sale_${s.caseId}`]);
  expect(t.cards).toBe(0); // the standard sale card never showed for it on Teams Arena
  expect(t.maxTeam).toBe(1);
  // Standings still update from the real data pipeline.
  await expect(page.locator('[data-testid="member-row"][data-user="UI-SIGMA-0"] [data-testid="member-validated"]')).toHaveText("5");
  expect(errors).toEqual([]);
});

test("Panthers sale on Teams Arena → black panther, official Panthers crest; closer name never used for the team", async ({ page }) => {
  const errors = errorsOf(page);
  await watch(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await page.waitForTimeout(1200);
  // A Panthers user_code whose display name is the SAME as a Sigma member: the server's attribution (by user_code) wins.
  const s = saleEvent({ userCode: "UI-PANTHERS-0", closer: "Arsam Idrees", team: TEAM.panthers });
  d.stream(s.text);
  const cel = page.getByTestId("team-celebration");
  await expect(cel).toBeVisible({ timeout: 15_000 });
  await expect(cel).toHaveAttribute("data-theme", "panther");
  await expect(page.getByTestId("team-celebration-headline")).toHaveAttribute("data-headline", "TEAM PANTHERS GOT A SALE!");
  await expect(page.getByTestId("team-emblem")).toHaveAttribute("data-emblem", "panther");
  await expect(page.getByTestId("team-emblem-img")).toHaveAttribute("src", "/teams/celebrations/panthers-panther-emblem.webp");
  expect(await page.getByTestId("team-emblem-img").evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(1600);
  await expect(cel.getByTestId("team-celebration-crest")).toHaveAttribute("src", "/teams/team-panthers.webp");
  await expect(page.getByTestId("team-celebration-total")).toHaveCount(0); // no verified figure yet: none shown
  await page.waitForTimeout(1900);
  await page.screenshot({ path: `${SHOTS}/panthers-panther-1920x1080.png` });
  await expect(cel).toBeHidden({ timeout: 10_000 });
  expect((await tc(page)).cards).toBe(0);
  expect(errors).toEqual([]);
});

test("a team created later (no preset mascot, no logo) → its own crest celebration with initials; dynamic headline", async ({ page }) => {
  const errors = errorsOf(page);
  await watch(page);
  const d = await display(page, { slugs: ["panthers", "sigma", "falcons"] });
  await openTeams(page, 3);
  await page.waitForTimeout(1200);
  d.stream(saleEvent({ userCode: "UI-FALCONS-0", closer: "Faris Khan", team: TEAM.falcons }).text);
  const cel = page.getByTestId("team-celebration");
  await expect(cel).toHaveAttribute("data-theme", "crest", { timeout: 15_000 });
  await expect(page.getByTestId("team-celebration-headline")).toHaveAttribute("data-headline", "TEAM FALCONS GOT A SALE!");
  await expect(page.getByTestId("team-crest-hero")).toBeVisible();
  await expect(cel.getByTestId("team-celebration-crest")).toHaveAttribute("data-fallback", "initials");
  await expect(cel.getByTestId("team-celebration-crest")).toHaveText("FA");
  await expect(page.getByTestId("team-emblem")).toHaveCount(0); // no preset emblem for a new team
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/generic-crest-1920x1080.png` });
  expect(errors).toEqual([]);
});

test("unsafe attribution on Teams Arena → the standard sale card, never a team animal (unassigned, archived Alpha, unknown, not competing)", async ({ page }) => {
  const errors = errorsOf(page);
  await watch(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await page.waitForTimeout(1200);
  const events = [
    saleEvent({ userCode: "UI-NEW-1", closer: "New Agent", team: null }), // unassigned
    saleEvent({ userCode: "UI-ALPHA-0", closer: "Rehan Ali", team: TEAM.alpha }), // archived team
    saleEvent({ userCode: "UI-X-1", closer: "Old Server", omitTeam: true }), // no attribution sent
    saleEvent({ userCode: "UI-FALCONS-0", closer: "Faris Khan", team: TEAM.falcons }), // active but not on this display
  ];
  d.stream(events.map((e) => e.text).join(""));
  await expect.poll(async () => (await cardNames(page)).sort(), { timeout: 60_000 }).toEqual(["Faris Khan", "New Agent", "Old Server", "Rehan Ali"]);
  const t = await tc(page);
  expect(t.cases).toEqual([]);
  await expect(page.getByTestId("team-celebration")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const mode of ["daily", "weekly", "monthly"] as const) {
  test(`${mode}: a Sigma / Panthers sale shows the ORIGINAL sale card, never the team celebration`, async ({ page }) => {
    const errors = errorsOf(page);
    await watch(page);
    const d = await display(page, { slugs: TWO });
    await openScreen(page, mode);
    d.stream(saleEvent({ userCode: "UI-SIGMA-0", closer: "Arsam Idrees", team: mode === "weekly" ? TEAM.panthers : TEAM.sigma }).text);
    await expect(page.getByText("SALE VALIDATED!")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Arsam Idrees · +1 Validated Sale — great work!")).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/regression-${mode}-sale-card.png` });
    await expect(page.getByTestId("team-celebration")).toHaveCount(0);
    expect((await tc(page)).cases).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("Spin & Win: unchanged (standard sale card, no team celebration)", async ({ page }) => {
  await watch(page);
  const d = await display(page, { slugs: TWO });
  await openScreen(page, "spin");
  d.stream(saleEvent({ userCode: "UI-SIGMA-0", closer: "Arsam Idrees", team: TEAM.sigma }).text);
  await expect(page.getByText("SALE VALIDATED!")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("team-celebration")).toHaveCount(0);
});

test("two displays, same sale: Teams Arena shows the lion, Daily shows the sale card (each by its own screen)", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await watch(a);
  await watch(b);
  const da = await display(a, { slugs: TWO });
  const db = await display(b, { slugs: TWO });
  await openTeams(a, 2);
  await openScreen(b, "daily");
  await a.waitForTimeout(800);
  const s = saleEvent({ userCode: "UI-SIGMA-0", closer: "Arsam Idrees", team: TEAM.sigma });
  da.stream(s.text);
  db.stream(s.text);
  await expect(a.getByTestId("team-celebration")).toHaveAttribute("data-theme", "lion", { timeout: 15_000 });
  await expect(b.getByText("SALE VALIDATED!")).toBeVisible({ timeout: 15_000 });
  await expect(b.getByTestId("team-celebration")).toHaveCount(0);
  await a.waitForTimeout(6500);
  expect((await tc(a)).cards).toBe(0);
  await a.context().close();
  await b.context().close();
});

test("duplicates: the stream redelivers on reconnect and the background sync recovers the same case → one celebration, never replayed", async ({ page }) => {
  const errors = errorsOf(page);
  await watch(page);
  const d = await display(page, { slugs: TWO, values: { liveSyncSeconds: 10 } });
  const s = saleEvent({ userCode: "UI-SIGMA-0", closer: "Arsam Idrees", team: TEAM.sigma });
  let recent: unknown[] = [];
  await page.route("**/api/arena/sync", (r) =>
    r.fulfill({ json: { ok: true, serverTime: new Date().toISOString(), fp: { sales: `x${recent.length}`, awards: "a", programs: "p", config: 1, screen: 0, display: 0, catalog: "", teams: "t" }, recentSales: recent, recoveryWindowSec: 600 } }),
  );
  await openTeams(page, 2);
  await page.waitForTimeout(1500);
  d.stream(s.text, 3); // first delivery + 2 redeliveries after reconnects
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 15_000 });
  // The same case also appears in the background sync's recent sales (as after a missed event).
  recent = [{ caseId: s.caseId, userCode: "UI-SIGMA-0", closerName: "Arsam Idrees", validatedAt: iso(Date.now() - 3000), firstSeenAt: iso(Date.now() - 500), source: "sse", team: TEAM.sigma }];
  // Period switching and standings refreshes during the celebration never restart or duplicate it.
  await page.getByTestId("team-celebration").evaluate((e) => ((e as HTMLElement).dataset.marker = "first"));
  await page.getByTestId("teams-period-week").click();
  await page.getByTestId("teams-period-day").click();
  await expect(page.getByTestId("team-celebration")).toHaveAttribute("data-marker", "first");
  await page.waitForTimeout(25_000); // reconnects + at least two background checks
  const t = await tc(page);
  expect(t.cases).toEqual([`celeb_sale_${s.caseId}`]);
  expect(t.cards).toBe(0);
  expect(errors).toEqual([]);
});

test("missed on the stream → recovered by the background sync, celebrated once with its team", async ({ page }) => {
  await watch(page);
  await display(page, { slugs: TWO, values: { liveSyncSeconds: 10 } });
  let recent: unknown[] = [];
  let n = 0;
  await page.route("**/api/arena/sync", (r) =>
    r.fulfill({ json: { ok: true, serverTime: new Date().toISOString(), fp: { sales: `x${n++}`, awards: "a", programs: "p", config: 1, screen: 0, display: 0, catalog: "", teams: "t" }, recentSales: recent, recoveryWindowSec: 600 } }),
  );
  await openTeams(page, 2);
  await page.waitForTimeout(1500);
  const caseId = `TC-MISSED-${Date.now()}`;
  recent = [{ caseId, userCode: "UI-PANTHERS-1", closerName: "Hamna Nasir", validatedAt: iso(Date.now() - 4000), firstSeenAt: iso(Date.now() - 200), source: "reconciliation", team: TEAM.panthers }];
  await expect(page.getByTestId("team-celebration")).toHaveAttribute("data-theme", "panther", { timeout: 30_000 });
  await expect(page.getByTestId("team-celebration-agent")).toHaveText("Hamna Nasir");
  await page.waitForTimeout(15_000);
  expect((await tc(page)).cases).toEqual([`celeb_sale_${caseId}`]);
});

test("rapid sales: Sigma then Panthers queue one at a time (none dropped, never stacked)", async ({ page }) => {
  await watch(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await page.waitForTimeout(1200);
  const a = saleEvent({ userCode: "UI-SIGMA-1", closer: "Sahibzada Hassan Mehboob", team: TEAM.sigma });
  const b = saleEvent({ userCode: "UI-PANTHERS-2", closer: "Syed Ali Asghar Zaidi", team: TEAM.panthers });
  d.stream(a.text + b.text);
  await expect.poll(async () => (await tc(page)).cases.length, { timeout: 30_000 }).toBe(2);
  const t = await tc(page);
  expect(t.cases).toEqual([`celeb_sale_${a.caseId}`, `celeb_sale_${b.caseId}`]);
  expect(t.themes).toEqual(["lion", "panther"]);
  expect(t.maxTeam).toBe(1);
  await page.screenshot({ path: `${SHOTS}/rapid-second-panther-1920x1080.png` });
});

test("sale + its individual cash bonus: both shown, never overlapping; the bonus stays individual (no team prize)", async ({ page }) => {
  const errors = errorsOf(page);
  await watch(page);
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await page.waitForTimeout(1200);
  const now = Date.now();
  const award = {
    id: `tc-award-${now}`, programId: "ui-sr2", kind: "daily", agentId: "agt_UI-SIGMA-0", userCode: "UI-SIGMA-0", agentName: "Arsam Idrees", periodKey: "D:ui", n: 1, validatedAtAward: 2, amount: 2000, prizeLabel: "",
    programName: "FE Senior Daily 2", salesRequired: 2, rewardType: "cash", currency: "PKR", announce: true, createdAt: iso(now), upgrade: false, previousAmount: 0, incrementAmount: 2000,
  };
  const s = saleEvent({ userCode: "UI-SIGMA-0", closer: "Arsam Idrees", team: TEAM.sigma });
  d.stream(s.text + sse("rewards.award.created", { award, validatedAt: iso(now - 2000), source: "sse", firstSeenAt: iso(now - 300), broadcastAt: iso(now) }));
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("bonus-popup")).toContainText("2,000");
  await expect(page.getByTestId("bonus-popup")).toContainText("Arsam Idrees");
  await page.screenshot({ path: `${SHOTS}/bonus-priority-1920x1080.png` });
  await expect.poll(async () => (await tc(page)).cases.length, { timeout: 60_000 }).toBe(1);
  await page.waitForTimeout(7000);
  const t = await tc(page);
  expect(t.bonus).toBe(1);
  expect(t.overlapBonus).toBe(0);
  expect(t.overlapCard).toBe(0);
  expect(t.cards).toBe(0);
  // The team celebration never shows a cash value.
  expect(errors).toEqual([]);
});

test("reduced motion → static composition; Lite → short motion; both readable", async ({ browser }) => {
  for (const [name, ctxOpts, values, expected] of [
    ["reduced", { reducedMotion: "reduce" as const }, {}, "static"],
    ["lite", { reducedMotion: "no-preference" as const }, { teamSaleMotion: "lite" }, "lite"],
  ] as const) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const d = await display(page, { slugs: TWO, values });
    await openTeams(page, 2);
    await page.waitForTimeout(1200);
    d.stream(saleEvent({ userCode: "UI-SIGMA-0", closer: "Arsam Idrees", team: TEAM.sigma }).text);
    const cel = page.getByTestId("team-celebration");
    await expect(cel).toHaveAttribute("data-motion", expected, { timeout: 15_000 });
    await page.waitForTimeout(900);
    const anim = await cel.evaluate((e) => [...e.querySelectorAll("*")].filter((x) => getComputedStyle(x).animationName !== "none").length);
    if (expected === "static") expect(anim).toBe(0);
    else expect(await page.locator(".tc-emblem-light").evaluate((e) => getComputedStyle(e).animationName)).toBe("none"); // no light pass / parallax in Lite
    await expect(page.getByTestId("team-celebration-headline")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/sigma-${name}.png` });
    await ctx.close();
  }
});

test("sound: the stinger respects mute; with sound on it plays only after the browser allowed audio", async ({ browser }) => {
  for (const [values, click, expected] of [
    [{ soundEnabled: false }, true, "muted"],
    [{ teamSaleSound: false }, true, "muted"],
    [{}, false, "locked"],
    [{}, true, "played"],
  ] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const d = await display(page, { slugs: TWO, values });
    await openTeams(page, 2);
    if (click) await page.mouse.click(5, 300); // a user gesture: the app unlocks audio
    await page.waitForTimeout(800);
    d.stream(saleEvent({ userCode: "UI-PANTHERS-0", closer: "Syed Noroz Ali Kazmi", team: TEAM.panthers }).text);
    await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.teamStinger), { timeout: 5000 }).toBe(expected);
    await ctx.close();
  }
});

for (const vp of [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`fits ${vp.width}×${vp.height}: headline, closer, mascot and crest inside the screen, nothing clipped`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: vp, reducedMotion: "no-preference" });
    const page = await ctx.newPage();
    const d = await display(page, { slugs: TWO, cub: false });
    await openTeams(page, 2);
    await page.waitForTimeout(1200);
    d.stream(saleEvent({ userCode: "UI-SIGMA-1", closer: "Sahibzada Hassan Mehboob", team: TEAM.sigma }).text);
    await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2900); // the full composition is in place
    const m = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const boxes = { headline: r('[data-testid="team-celebration-headline"]'), agent: r('[data-testid="team-celebration-agent"]'), mascot: r('[data-testid="team-emblem"] .tc-emblem-plate'), crest: r('[data-testid="team-celebration"] [data-testid="team-celebration-crest"]') };
      const inside = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1]));
      const h = document.querySelector('[data-testid="team-celebration-headline"]') as HTMLElement;
      const a = document.querySelector('[data-testid="team-celebration-agent"]') as HTMLElement;
      return { inside, clipped: h.scrollWidth > h.clientWidth + 1 || a.scrollWidth > a.clientWidth + 1, overflowX: document.documentElement.scrollWidth - innerWidth, headlinePx: parseFloat(getComputedStyle(h).fontSize), agentPx: parseFloat(getComputedStyle(a).fontSize) };
    });
    await page.screenshot({ path: `${SHOTS}/fit-${vp.width}x${vp.height}.png` });
    expect(m.inside).toEqual({ headline: true, agent: true, mascot: true, crest: true });
    expect(m.clipped).toBe(false);
    expect(m.overflowX).toBeLessThanOrEqual(0);
    expect(m.headlinePx).toBeGreaterThanOrEqual(24);
    expect(m.agentPx).toBeGreaterThanOrEqual(18);
    await ctx.close();
  });
}

test("timing: on screen within ~1 s of the event reaching the display, ~5.6 s on screen, then gone", async ({ page }) => {
  const d = await display(page, { slugs: TWO });
  await openTeams(page, 2);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const w = window as unknown as { __t: Record<string, number> };
    w.__t = {};
    const iv = setInterval(() => {
      const on = !!document.querySelector('[data-testid="team-celebration"]');
      if (on && !w.__t.shown) w.__t.shown = performance.now();
      if (!on && w.__t.shown && !w.__t.gone) {
        w.__t.gone = performance.now();
        clearInterval(iv);
      }
    }, 25);
  });
  d.stream(saleEvent({ userCode: "UI-SIGMA-0", closer: "Arsam Idrees", team: TEAM.sigma }).text);
  await expect(page.getByTestId("team-celebration")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __t: Record<string, number> }).__t.gone ?? 0), { timeout: 15_000 }).toBeGreaterThan(0);
  const lat = await page.evaluate(() => {
    const l = (window as unknown as { __arenaLatency: Array<{ key: string; receivedAt: string; enqueuedAt?: string; shownAt?: string; presentation?: string; stages: Record<string, number | null> }> }).__arenaLatency;
    const t = (window as unknown as { __t: Record<string, number> }).__t;
    return { entry: l[l.length - 1], visibleMs: t.gone - t.shown };
  });
  expect(lat.entry.presentation).toBe("team");
  expect(lat.entry.stages.browserToEnqueue).toBeLessThan(100); // enqueued in the same tick as the event
  expect(lat.entry.stages.browserToPopup).toBeLessThan(1500); // visible promptly (nothing else queued)
  expect(lat.visibleMs).toBeGreaterThan(5200);
  expect(lat.visibleMs).toBeLessThan(7000);
  console.log(`[timing] receipt→enqueue ${lat.entry.stages.browserToEnqueue} ms, receipt→visible ${lat.entry.stages.browserToPopup} ms, on screen ${Math.round(lat.visibleMs)} ms`);
});
