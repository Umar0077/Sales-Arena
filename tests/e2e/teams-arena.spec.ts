import { test, expect, type Page, type Route } from "@playwright/test";
import { cub, minsAgo, rig, sse } from "./cub-helpers";

/**
 * Teams Arena in the browser. The display's /api/arena/teams answer is controlled by the test (browser-side
 * interception, nothing written anywhere) so rank changes can be staged; the logos, settings, stream and
 * popups are the real application. Admin tests use the local dev database (an E2E team, never production).
 */
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1920, height: 1080 }, contextOptions: { reducedMotion: "no-preference" } });
test.describe.configure({ timeout: 240_000 });

const TEAMS_ON = { arenaModes: { daily: true, weekly: true, monthly: true, teams: true, spin: true }, liveSyncSeconds: 120 };
const ROSTER: Record<string, string[]> = {
  alpha: ["Rehan Ali", "Urwah Malik", "Mansoor Arshad", "Rayyan Mughal", "Uswa E Husna", "Hina Javed", "Roger Robinson", "Abdul Hadi", "Adil Faryad", "Ehsan Zahid"],
  panthers: ["Hamna Nasir", "Muhammad Balaj", "Syed Ali Asghar Zaidi", "Syed Noroz Ali Kazmi", "Jonathan", "Syeda Zubia Farhan", "Sumaiya Majeed", "Mudassir Tanveer", "M Ishaq", "Noor Kiyani"],
  sigma: ["Arsam Idrees", "Kanwal Farooq", "Muhammad Adeel Afzal", "Sahibzada Hassan Mehboob Khan", "Haris Malik", "Syed Farhan", "Alishba", "Ali Baloch", "Ali Sikandar", "Rajab Rehan"],
};
const NAME: Record<string, string> = { alpha: "Team Alpha", panthers: "Team Panthers", sigma: "Team Sigma" };
const COLOR: Record<string, string> = { alpha: "#22D3FF", panthers: "#A855F7", sigma: "#8B5CF6" };

/** Display-only standings fixture (same shape the server sends). figures: slug → validated per member index. */
function standings(period: string, figures: Record<string, number[]>) {
  const teams = Object.keys(ROSTER).map((slug, ti) => {
    const members = ROSTER[slug].map((name, i) => {
      const validated = figures[slug]?.[i] ?? 0;
      const submitted = validated ? validated + 1 : i < 3 ? 1 : 0;
      return { userCode: `E2E-${slug.toUpperCase()}-${i}`, name, designation: i < 5 ? "senior" : "junior", validated, submitted, closeRate: submitted ? Math.round((validated / submitted) * 1000) / 10 : null };
    });
    members.sort((a, b) => b.validated - a.validated || b.submitted - a.submitted || a.name.localeCompare(b.name));
    return {
      id: `team_${slug}`, name: NAME[slug], slug, logoUrl: `/teams/team-${slug}.webp`, color: COLOR[slug], accentSecondary: null, displayOrder: ti + 1, leaderUserCode: null,
      members: members.map((m, i) => ({ ...m, rank: i + 1, tied: false })),
      validated: members.reduce((s, m) => s + m.validated, 0), submitted: members.reduce((s, m) => s + m.submitted, 0), closeRate: null, memberCount: 10,
    };
  });
  teams.sort((a, b) => b.validated - a.validated || b.submitted - a.submitted || a.displayOrder - b.displayOrder);
  const ranked = teams.map((t, i) => ({ ...t, rank: i + 1, tied: false }));
  const top = ranked.flatMap((t) => t.members.filter((m) => m.validated > 0).map((m) => ({ ...m, teamId: t.id, teamName: t.name, teamSlug: t.slug, teamLogoUrl: t.logoUrl, teamColor: t.color })))
    .sort((a, b) => b.validated - a.validated || b.submitted - a.submitted).slice(0, 3).map((m, i) => ({ ...m, rank: i + 1 }));
  const labels: Record<string, string> = { day: "Today · Nov 5, 2026", week: "This Week · Nov 2 – Nov 5, 2026", month: "This Month · Nov 1 – Nov 5, 2026" };
  return { ok: true, period, from: "2026-11-01", to: "2026-11-05", label: labels[period], teams: ranked, top, leaderTeamId: ranked[0].validated > ranked[1].validated ? ranked[0].id : null, attribution: "", generatedAt: new Date().toISOString() };
}

async function mockStandings(page: Page) {
  const st = { figures: { sigma: [3, 2, 1], alpha: [2, 1], panthers: [1] } as Record<string, number[]>, requests: [] as string[] };
  await page.route("**/api/arena/teams?**", async (route: Route) => {
    const period = new URL(route.request().url()).searchParams.get("period") ?? "day";
    st.requests.push(period);
    await route.fulfill({ json: standings(period, st.figures) });
  });
  return st;
}

test("Teams Arena: three ranked teams with official logos, all 30 members (zero-sale included), top 3, period switch, no reload", async ({ page }) => {
  const st = await mockStandings(page);
  await (await rig(page)).open({ lastSaleAt: minsAgo(2), values: TEAMS_ON });
  await page.getByRole("tab", { name: "Teams Arena" }).click();
  await expect(page.getByTestId("teams-screen")).toBeVisible();
  const cards = page.getByTestId("team-card");
  await expect(cards).toHaveCount(3);
  expect(await cards.evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.team, (e as HTMLElement).dataset.rank]))).toEqual([["sigma", "1"], ["alpha", "2"], ["panthers", "3"]]);
  await expect(cards.first()).toHaveAttribute("data-leader", "true");
  await expect(cards.nth(0).getByTestId("team-rank")).toHaveText("1ST");
  await expect(cards.nth(1).getByTestId("team-rank")).toHaveText("2ND");
  await expect(cards.nth(2).getByTestId("team-rank")).toHaveText("3RD");
  // The official artwork really loads (not a broken image / fallback).
  const logos = await page.locator('[data-testid="team-card"] img').evaluateAll((imgs) => imgs.map((i) => [(i as HTMLImageElement).getAttribute("src"), (i as HTMLImageElement).naturalWidth]));
  expect(logos.map((l) => l[0]).sort()).toEqual(["/teams/team-alpha.webp", "/teams/team-panthers.webp", "/teams/team-sigma.webp"]);
  for (const [, w] of logos) expect(Number(w)).toBeGreaterThan(0);
  await expect(cards.nth(0).getByTestId("team-validated")).toHaveAttribute("data-value", "6");
  // Every member is listed, including the 24 with no sales.
  await expect(page.getByTestId("member-row")).toHaveCount(30);
  await expect(page.locator('[data-testid="member-row"][data-validated="0"]')).toHaveCount(24);
  await expect(page.getByTestId("team-board").first().getByTestId("designation").first()).toHaveText("SR");
  await expect(page.locator('[data-testid="designation"]', { hasText: "JR" })).not.toHaveCount(0);
  const top = page.getByTestId("top-performer");
  await expect(top).toHaveCount(3);
  await expect(top.first()).toContainText("Arsam Idrees");
  await expect(top.first()).toContainText("Team Sigma");
  await page.screenshot({ path: "playwright-report/arena-cub/teams-1920x1080.png" });
  // Period switch: fetches that period, never shows another period's numbers.
  const loads = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  await page.getByTestId("teams-period-week").click();
  await expect(page.getByTestId("teams-period-label")).toHaveText(/This Week/);
  await page.getByTestId("teams-period-month").click();
  await expect(page.getByTestId("teams-period-label")).toHaveText(/This Month/);
  expect(st.requests).toEqual(expect.arrayContaining(["day", "week", "month"]));
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(loads);
  // Direct link.
  await page.goto("/?screen=teams");
  await expect(page.getByTestId("teams-screen")).toBeVisible({ timeout: 60_000 });
});

test("on Teams Arena: genuine sale + bonus popups, the cub, ONE stream connection across screen switches, lead change only on a real change", async ({ page }) => {
  const st = await mockStandings(page);
  const streams: string[] = [];
  page.on("request", (r) => r.url().includes("/api/arena/stream") && streams.push(r.url()));
  await page.addInitScript(() => {
    const w = window as unknown as { __saleShows: number; __bonusShows: number; __takeovers: number };
    w.__saleShows = 0;
    w.__bonusShows = 0;
    w.__takeovers = 0;
    let s = false, b = false, t = false;
    setInterval(() => {
      const ns = document.body?.innerText.includes("SALE VALIDATED!") ?? false;
      const nb = !!document.querySelector('[data-testid="bonus-popup"]');
      const nt = !!document.querySelector('[data-testid="lead-takeover"]');
      if (ns && !s) w.__saleShows++;
      if (nb && !b) w.__bonusShows++;
      if (nt && !t) w.__takeovers++;
      s = ns; b = nb; t = nt;
    }, 50);
  });
  const r = await rig(page);
  await r.open({ lastSaleAt: minsAgo(2), values: TEAMS_ON });
  await page.getByRole("tab", { name: "Teams Arena" }).click();
  await expect(page.getByTestId("team-card")).toHaveCount(3);
  await expect(cub(page)).toBeVisible({ timeout: 20_000 }); // the cub stays on Teams Arena
  // Switching screens never opens another live-stream connection.
  const s0 = streams.length;
  for (const tab of ["Daily Arena", "Teams Arena", "Weekly Arena", "Teams Arena"]) await page.getByRole("tab", { name: tab }).click();
  await page.waitForTimeout(1500);
  expect(streams.length).toBe(s0);
  expect(await page.evaluate(() => (window as unknown as { __takeovers: number }).__takeovers)).toBe(0); // first loads: no fake lead change

  // A genuine sale for Panthers' Hamna arrives on the stream; Safe Quote's figures now put Panthers first.
  st.figures = { panthers: [5, 2], sigma: [3, 2, 1], alpha: [2, 1] };
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const award = {
    id: `e2e-teams-award-${now}`, programId: "e2e-sr2", kind: "daily", agentId: "agt_E2E-PANTHERS-0", userCode: "E2E-PANTHERS-0", agentName: "Hamna Nasir", periodKey: "D:e2e", n: 1,
    validatedAtAward: 2, amount: 2000, prizeLabel: "", programName: "FE Senior Daily 2", salesRequired: 2, rewardType: "cash", currency: "PKR", announce: true, createdAt: iso(now), upgrade: false, previousAmount: 0, incrementAmount: 2000,
  };
  r.stream(
    sse("sale.validated", { caseId: `E2E-TEAMS-${now}`, userCode: "E2E-PANTHERS-0", closerName: "Hamna Nasir", validatedAt: iso(now - 2000), source: "sse", firstSeenAt: iso(now - 300), storedAt: iso(now - 200), broadcastAt: iso(now - 100) }) +
      sse("rewards.award.created", { award, validatedAt: iso(now - 2000), source: "sse", firstSeenAt: iso(now - 300), broadcastAt: iso(now) }),
    2,
  );
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("bonus-popup")).toContainText("2,000");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saleShows: number }).__saleShows), { timeout: 25_000 }).toBe(1);
  // The live sale refreshed the live data → the Teams Arena reloads: Panthers lead, banner once, the row is highlighted.
  await expect(page.getByTestId("team-card").first()).toHaveAttribute("data-team", "panthers", { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __takeovers: number }).__takeovers), { timeout: 10_000 }).toBe(1);
  await expect(page.getByTestId("lead-takeover")).toContainText("Team Panthers takes the lead");
  await expect(page.locator('[data-testid="member-row"][data-user="E2E-PANTHERS-0"]')).toHaveAttribute("data-fresh", "true");
  await page.screenshot({ path: "playwright-report/arena-cub/teams-lead-change.png" });
  // A reconnect redelivers the events: standings reload, but no popup or banner is replayed.
  await page.waitForTimeout(9000);
  expect(await page.evaluate(() => { const w = window as unknown as { __saleShows: number; __bonusShows: number; __takeovers: number }; return { s: w.__saleShows, b: w.__bonusShows, t: w.__takeovers }; })).toEqual({ s: 1, b: 1, t: 1 });
});

test("Admin: Teams Arena screen controls (enable, tab visibility, switch) and the Senior / Junior bonus views", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ storageState: "tests/e2e/.auth/admin.json", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/admin/programs`);
  await expect(page.getByTestId("screen-toggles")).toContainText("Teams Arena", { timeout: 60_000 });
  await expect(page.getByText("Show the Teams Arena tab")).toBeVisible();
  // Senior / Junior bonus audience.
  await page.getByRole("tab", { name: "Daily Rewards" }).click();
  await expect(page.getByTestId("audience-tabs")).toBeVisible();
  await page.getByTestId("audience-junior").click();
  await expect(page.getByTestId("junior-empty").or(page.getByTestId("program-list"))).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("audience-senior").click();
  await expect(page.getByTestId("audience-review").or(page.getByTestId("audience-done"))).toBeVisible({ timeout: 30_000 });
  // Missing Awards can be scanned for Junior only: none configured → says so, writes nothing.
  await page.getByRole("tab", { name: "Award History" }).click();
  await expect(page.getByTestId("award-history")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("open-recovery").click();
  await page.getByTestId("scan-audience").selectOption("junior");
  await page.getByTestId("scan-run").click();
  await expect(page.getByTestId("scan-result")).toBeVisible({ timeout: 60_000 });
  await ctx.close();
});

test("Admin Team Management: teams with logos, roster preview is read-only, assign / designate / transfer / remove, secure logo upload", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ storageState: "tests/e2e/.auth/admin.json", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/admin/teams`);
  await expect(page.getByTestId("team-management")).toBeVisible({ timeout: 60_000 });
  // The sidebar entry exists and navigation keeps working.
  await expect(page.getByRole("link", { name: "Team Management" })).toBeVisible();
  // Roster import preview: real matching, nothing written by looking.
  await page.getByRole("tab", { name: "Initial roster import" }).click();
  await expect(page.getByTestId("import-row")).toHaveCount(30, { timeout: 60_000 });
  await expect(page.locator('[data-testid="import-row"][data-status="unmatched"]').first()).toBeVisible();
  await expect(page.getByTestId("import-apply")).toBeDisabled(); // needs the explicit confirmation
  // A temporary E2E team (dev database only).
  await page.getByRole("tab", { name: "Teams" }).click();
  const name = `E2E Team ${Date.now() % 100000}`;
  await page.getByTestId("new-team-name").fill(name);
  await page.getByTestId("create-team").click();
  await expect(page.getByText(`Team “${name}” created`)).toBeVisible();
  const card = page.locator('[data-testid="admin-team"]', { hasText: name });
  // Logo upload: a real PNG is accepted, an SVG is refused.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await card.getByTestId("team-logo-upload").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText(/logo updated/)).toBeVisible();
  await expect(card.getByTestId("admin-team-logo")).toBeVisible();
  await card.getByTestId("team-logo-upload").setInputFiles({ name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(page.getByText(/PNG, JPEG or WebP/)).toBeVisible();
  // Assign an unassigned verified agent with a designation, change designation, then remove (same day: never counted).
  await page.getByRole("tab", { name: "Members" }).click();
  const agentSel = page.getByTestId("assign-agent");
  const option = await agentSel.locator("option").nth(1).getAttribute("value");
  test.skip(!option, "No unassigned agent in the dev database");
  await agentSel.selectOption(option!);
  await page.getByTestId("assign-team").selectOption({ label: name });
  await page.getByTestId("assign-designation").selectOption("junior");
  await page.getByTestId("assign-submit").click();
  await expect(page.getByText("Agent assigned.")).toBeVisible();
  const row = page.locator(`[data-testid="admin-member"][data-user="${option}"]`);
  await expect(row.getByTestId("member-designation")).toHaveValue("junior");
  await row.getByTestId("member-designation").selectOption("senior");
  await expect(page.getByText(/is now Senior/)).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await row.getByTestId("member-remove").click();
  await expect(page.getByText(/removed from/)).toBeVisible();
  await expect(row).toHaveCount(0);
  // History shows the trail; then retire the E2E team.
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByTestId("team-history")).toBeVisible();
  await page.getByRole("tab", { name: "Teams" }).click();
  await card.getByTestId("team-active").click();
  await expect(page.getByText(/deactivated/)).toBeVisible();
  await ctx.close();
});

for (const vp of [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`Teams Arena layout ${vp.width}×${vp.height}: everything present, no horizontal overflow`, async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: vp, reducedMotion: "no-preference" });
    const page = await ctx.newPage();
    await mockStandings(page);
    await (await rig(page)).open({ lastSaleAt: minsAgo(2), values: TEAMS_ON });
    await page.goto("/?screen=teams");
    await expect(page.getByTestId("team-card")).toHaveCount(3, { timeout: 60_000 });
    await expect(page.getByTestId("member-row")).toHaveCount(30); // never dropped for space (internal scrolling instead)
    await expect(page.getByTestId("teams-top3")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    if (vp.width >= 1600) {
      // TV sizes: cards, top 3 and all three boards are on screen together.
      for (const id of ["team-card", "team-board"]) {
        const boxes = await page.getByTestId(id).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
        for (const top of boxes) expect(top).toBeLessThan(vp.height);
      }
    }
    await page.screenshot({ path: `playwright-report/arena-cub/teams-${vp.width}x${vp.height}.png`, fullPage: vp.width < 1280 });
    await ctx.close();
  });
}
