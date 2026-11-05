import { test, expect } from "@playwright/test";
import { sse } from "./cub-helpers";
import { TWO, MONTH, standings, display, errorsOf, openTeams, type Figs } from "./teams-ui-helpers";

/**
 * Teams Arena UI (redesign), run WITHOUT a database: playwright.ui.config.ts. The settings, team standings, cub
 * activity and the live stream are answered by the test inside the browser; the screen, its crests, styles,
 * animations, popups and the Arena Cub are the real application. Nothing is written anywhere.
 */
test.describe.configure({ timeout: 180_000 });


test("new official crests: the transparent artwork loads crisply on its lit plate, in every card", async ({ page }) => {
  const errors = errorsOf(page);
  await display(page);
  await openTeams(page);
  const logos = page.locator('[data-testid="team-card"] [data-testid="team-logo"]');
  await expect(logos).toHaveCount(3);
  const info = await logos.evaluateAll((imgs) =>
    Promise.all(
      (imgs as HTMLImageElement[]).map(async (img) => {
        await img.decode().catch(() => {});
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const corner = ctx.getImageData(2, 2, 1, 1).data[3]; // transparent corner = real cut-out, no square tile
        const centre = ctx.getImageData(img.naturalWidth >> 1, img.naturalHeight >> 1, 1, 1).data[3];
        const box = img.getBoundingClientRect();
        return { src: img.getAttribute("src"), w: img.naturalWidth, corner, centre, shown: Math.round(box.width), filter: getComputedStyle(img).filter };
      }),
    ),
  );
  expect(info.map((i) => i.src).sort()).toEqual(["/teams/team-alpha.webp", "/teams/team-panthers.webp", "/teams/team-sigma.webp"]);
  for (const i of info) {
    expect(i.w).toBe(384); // crisp: never shown larger than its pixels on a 1080p display
    expect(i.shown).toBeLessThanOrEqual(i.w);
    expect(i.corner).toBe(0);
    expect(i.centre).toBeGreaterThanOrEqual(250); // opaque artwork (WebP stores 254–255)
    expect(i.filter).toContain("drop-shadow"); // 3D lift + team glow
  }
  // Every crest sits on its plate with the halo and the pulse.
  await expect(page.locator(".teams-crest .teams-crest-halo")).toHaveCount(3);
  await expect(page.locator(".teams-crest .teams-crest-pulse")).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("ranked team cards: 1st on the left and in front (lifted, wider, gold, crown), 2nd and 3rd step back; same structure on every card", async ({ page }) => {
  await display(page);
  await openTeams(page);
  await page.getByTestId("teams-period-month").click();
  await expect(page.getByTestId("teams-period-label")).toHaveText(/This Month/);
  const cards = page.getByTestId("team-card");
  expect(await cards.evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.team, (e as HTMLElement).dataset.rank]))).toEqual([["sigma", "1"], ["alpha", "2"], ["panthers", "3"]]);
  await expect(cards.nth(0)).toHaveAttribute("data-leader", "true");
  await expect(cards.nth(0).getByLabel("Leading team")).toBeVisible();
  for (const [i, label] of ["1ST", "2ND", "3RD"].entries()) await expect(cards.nth(i).getByTestId("team-rank")).toHaveText(label);
  const box = await cards.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, right: r.right, frame: getComputedStyle(e).backgroundImage, shadow: getComputedStyle(e).boxShadow, z: Number(getComputedStyle(e.parentElement!).zIndex) };
    }),
  );
  expect(box[0].x).toBeLessThan(box[1].x);
  expect(box[1].x).toBeLessThan(box[2].x);
  expect(box[0].y).toBeLessThan(box[1].y); // lifted
  expect(box[1].y).toBeLessThan(box[2].y);
  expect(box[0].w).toBeGreaterThan(box[1].w);
  expect(box[1].w).toBeGreaterThan(box[2].w);
  expect(box[0].z).toBeGreaterThan(box[1].z); // layered in front
  expect(box[1].z).toBeGreaterThan(box[2].z);
  expect(box[0].frame).toContain("rgb(245, 196, 81)"); // gold
  expect(box[1].frame).toContain("rgba(201, 209, 224"); // silver
  expect(box[2].frame).toContain("rgba(208, 138, 79"); // bronze
  for (let i = 0; i < 2; i++) expect(box[i].right).toBeLessThanOrEqual(box[i + 1].x + 1); // never overlapping
  // Identical metric structure, real figures.
  for (let i = 0; i < 3; i++) for (const id of ["team-validated", "team-submitted", "team-rate"]) await expect(cards.nth(i).getByTestId(id)).toBeVisible();
  await expect(cards.nth(0).getByTestId("team-validated")).toHaveAttribute("data-value", "13");
  await expect(cards.nth(0).getByTestId("team-submitted")).toHaveAttribute("data-value", "23");
  await expect(cards.nth(0).getByTestId("team-rate")).toHaveText("57%");
  await expect(cards.nth(0).getByTestId("team-gap")).toContainText("Leading the floor");
  await expect(cards.nth(1).getByTestId("team-gap")).toContainText("8 behind 1st");
  await expect(page.getByTestId("teams-race-summary")).toContainText("23");
  await expect(page.getByTestId("teams-race-summary")).toContainText("Team Sigma");
});

test("only the top 3 of each team, ranked validated → submitted → name, under its own card; ties share a placement", async ({ page }) => {
  // Alpha: 3 members tied on validated (1); submitted breaks it; two fully tied members share a rank.
  const figs: Figs = { sigma: [[4, 8], [3, 4], [3, 3], [1, 4]], alpha: [[1, 2], [1, 6], [1, 2], [0, 9]], panthers: [[0, 2]] };
  const { st } = await display(page, { figs });
  await openTeams(page);
  await expect(page.getByTestId("member-row")).toHaveCount(9);
  const cols = page.getByTestId("team-column");
  for (let i = 0; i < 3; i++) {
    const slug = await cols.nth(i).getAttribute("data-team");
    await expect(cols.nth(i).getByTestId("team-board")).toHaveAttribute("data-team", slug!); // board directly under its card
    const expected = standings("day", st.figs).teams.find((t) => t.slug === slug)!.members.slice(0, 3);
    const rows = cols.nth(i).getByTestId("member-row");
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.user, (e as HTMLElement).dataset.rank]))).toEqual(expected.map((m) => [m.userCode, String(m.rank)]));
  }
  const alpha = page.locator('[data-testid="team-board"][data-team="alpha"] [data-testid="member-row"]');
  expect(await alpha.evaluateAll((els) => els.map((e) => e.querySelector("[title]")!.textContent))).toEqual(["Urwah Malik", "Rayyan Mughal", "Rehan Ali"]);
  expect(await alpha.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rank))).toEqual(["1", "2", "2"]); // shared placement
  // Medal colours only for members with a validated sale.
  const panthers = page.locator('[data-testid="team-board"][data-team="panthers"] [data-testid="member-row"]');
  await expect(panthers.locator('[data-testid="member-validated"]').first()).toHaveText("0");
  // Each row shows SR / JR, submitted, validated and the close rate.
  const first = page.locator('[data-testid="team-board"][data-team="sigma"] [data-testid="member-row"]').first();
  await expect(first.getByTestId("designation")).toHaveText("SR");
  await expect(first.getByTestId("member-submitted")).toHaveText("8");
  await expect(first.getByTestId("member-validated")).toHaveText("4");
  await expect(first).toContainText("50%");
});

test("Top Performers — All Teams: podium with the real top 3, and a designed empty state", async ({ page }) => {
  const d = await display(page);
  await openTeams(page);
  const top = page.getByTestId("top-performer");
  await expect(top).toHaveCount(3);
  expect(await top.evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.user, (e as HTMLElement).dataset.rank]))).toEqual([["UI-SIGMA-0", "1"], ["UI-ALPHA-0", "2"], ["UI-SIGMA-1", "3"]]);
  await expect(top.first()).toContainText("Arsam Idrees");
  await expect(top.first()).toContainText("Team Sigma");
  await expect(top.first().getByLabel("Top performer")).toBeVisible();
  const h = await top.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(h[0]).toBeGreaterThan(h[1]); // #1 featured
  // No validated sales in the period: an intentional empty state, never fake winners.
  d.st.figs = {};
  await page.getByTestId("teams-period-week").click();
  await expect(page.getByTestId("teams-top3-empty")).toBeVisible();
  await expect(page.getByTestId("top-performer")).toHaveCount(0);
  await expect(page.getByTestId("teams-top3-empty")).toContainText("The podium is open");
  await page.screenshot({ path: "playwright-report/teams-ui/teams-empty-1920x1080.png" });
});

test("period filters fetch their own period, never a page reload", async ({ page }) => {
  const d = await display(page);
  await openTeams(page);
  const nav = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  for (const [id, re] of [["week", /This Week/], ["month", /This Month/], ["day", /Today/]] as const) {
    await page.getByTestId(`teams-period-${id}`).click();
    await expect(page.getByTestId("teams-period-label")).toHaveText(re);
    await expect(page.getByTestId(`teams-period-${id}`)).toHaveAttribute("aria-selected", "true");
  }
  expect(d.st.requests).toEqual(expect.arrayContaining(["day", "week", "month"]));
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(nav);
});

test("motion: halo, pulse, sweep and live dot animate (transform / opacity only) and stop for reduced motion", async ({ browser }) => {
  for (const reduced of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = await ctx.newPage();
    await display(page);
    await openTeams(page);
    const anim = await page.evaluate(() => {
      const one = (sel: string) => {
        const e = document.querySelector(sel);
        return e ? getComputedStyle(e).animationName : "missing";
      };
      return {
        motion: !!document.querySelector(".teams-motion"),
        halo: one(".teams-crest-halo"),
        pulse: one(".teams-crest-pulse"),
        sweep: one(".teams-sweep"),
        ping: one(".teams-live-ping"),
        running: document.getAnimations().filter((a) => a instanceof CSSAnimation && /^teams/.test((a as CSSAnimation).animationName)).length,
      };
    });
    if (reduced) expect(anim).toMatchObject({ motion: false, halo: "none", pulse: "none", sweep: "missing", ping: "none", running: 0 });
    else {
      expect(anim).toMatchObject({ motion: true, halo: "teamsHalo", pulse: "teamsPulse", sweep: "teamsSweep", ping: "teamsPing" });
      expect(anim.running).toBeGreaterThanOrEqual(9);
      // Only composited properties are animated (no layout / paint-heavy properties).
      const props = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a instanceof CSSAnimation && /^teams/.test((a as CSSAnimation).animationName))
          .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !["offset", "easing", "composite", "computedOffset"].includes(p)))),
      );
      expect([...new Set(props)].sort()).toEqual(["opacity", "transform"]);
    }
    await ctx.close();
  }
});

test("live: a genuine sale + bonus on the stream show their popups on Teams Arena, the cub stays, a lead change animates once; other screens still open", async ({ page }) => {
  const errors = errorsOf(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __sale: number; __bonus: number; __lead: number };
    w.__sale = w.__bonus = w.__lead = 0;
    let s = false,
      b = false,
      l = false;
    setInterval(() => {
      const ns = document.body?.innerText.includes("SALE VALIDATED!") ?? false;
      const nb = !!document.querySelector('[data-testid="bonus-popup"]');
      const nl = !!document.querySelector('[data-testid="lead-takeover"]');
      if (ns && !s) w.__sale++;
      if (nb && !b) w.__bonus++;
      if (nl && !l) w.__lead++;
      s = ns;
      b = nb;
      l = nl;
    }, 50);
  });
  const d = await display(page);
  await openTeams(page);
  await expect(page.getByTestId("arena-cub")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as unknown as { __lead: number }).__lead)).toBe(0); // no fake lead change on load

  // Panthers' top member closes more sales: Panthers 14 validated vs Sigma 13.
  d.st.figs = { ...MONTH, panthers: [[11, 12], [2, 3], [1, 4]] };
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const award = {
    id: `ui-award-${now}`, programId: "ui-sr2", kind: "daily", agentId: "agt_UI-PANTHERS-0", userCode: "UI-PANTHERS-0", agentName: "Syed Noroz Ali Kazmi", periodKey: "D:ui", n: 1, validatedAtAward: 2, amount: 2000, prizeLabel: "",
    programName: "FE Senior Daily 2", salesRequired: 2, rewardType: "cash", currency: "PKR", announce: true, createdAt: iso(now), upgrade: false, previousAmount: 0, incrementAmount: 2000,
  };
  d.stream(
    sse("sale.validated", { caseId: `UI-${now}`, userCode: "UI-PANTHERS-0", closerName: "Syed Noroz Ali Kazmi", validatedAt: iso(now - 2000), source: "sse", firstSeenAt: iso(now - 300), storedAt: iso(now - 200), broadcastAt: iso(now - 100) }) +
      sse("rewards.award.created", { award, validatedAt: iso(now - 2000), source: "sse", firstSeenAt: iso(now - 300), broadcastAt: iso(now) }) +
      sse("teams.updated", { reason: "test" }),
  );
  await expect(page.getByTestId("bonus-popup")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("bonus-popup")).toContainText("2,000");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sale: number }).__sale), { timeout: 30_000 }).toBe(1);
  await expect(page.getByTestId("team-card").first()).toHaveAttribute("data-team", "panthers", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lead: number }).__lead), { timeout: 10_000 }).toBe(1);
  await expect(page.locator('[data-testid="member-row"][data-user="UI-PANTHERS-0"]')).toHaveAttribute("data-fresh", "true");
  await expect(page.getByTestId("arena-cub")).toBeVisible();
  await page.screenshot({ path: "playwright-report/teams-ui/teams-live-1920x1080.png" });

  // The other screens are untouched and still open from the same selector.
  for (const [tab, mode] of [["Daily Arena", "daily"], ["Weekly Arena", "weekly"], ["Monthly Arena", "monthly"], ["Teams Arena", "teams"]] as const) {
    await page.getByRole("tablist", { name: "Live Arena screen" }).getByRole("tab", { name: tab }).click();
    await expect(page.locator(`[data-arena-mode="${mode}"]`)).toBeVisible();
  }
  await expect(page.getByTestId("team-card")).toHaveCount(3);
  expect(errors).toEqual([]);
});

for (const vp of [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`layout ${vp.width}×${vp.height}: no overflow, no overlaps, no clipped names or numbers`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: vp, reducedMotion: "no-preference" });
    const page = await ctx.newPage();
    const errors = errorsOf(page);
    await display(page, { cub: false });
    await openTeams(page);
    await page.getByTestId("teams-period-month").click();
    await expect(page.getByTestId("teams-period-label")).toHaveText(/This Month/);
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const rect = (e: Element) => e.getBoundingClientRect();
      const all = (s: string) => [...document.querySelectorAll(s)];
      const blocks = [...all('[data-testid="team-card"]'), ...all('[data-testid="team-board"]'), ...all('[data-testid="teams-top3"]')].map(rect);
      let overlaps = 0;
      for (let i = 0; i < blocks.length; i++)
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i];
          const b = blocks[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++;
        }
      // Text that does not fit its box (team names, metric numbers, member names).
      const clipped = all('[data-testid="team-card"] h2, [data-testid="team-validated"], [data-testid="team-submitted"], [data-testid="team-rate"], [data-testid="member-validated"], [data-testid="member-row"] [title]')
        .filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1)
        .map((e) => e.textContent);
      const lowest = Math.max(...blocks.map((b) => b.bottom));
      return { overflowX: document.documentElement.scrollWidth - innerWidth, overlaps, clipped, lowest, rows: all('[data-testid="member-row"]').length };
    });
    expect(m.overflowX).toBeLessThanOrEqual(1);
    expect(m.overlaps).toBe(0);
    expect(m.rows).toBe(9);
    if (vp.width >= 1280) expect(m.clipped).toEqual([]); // phones truncate long names with a tooltip by design
    if (vp.width >= 1600) expect(m.lowest).toBeLessThanOrEqual(vp.height); // TV sizes: everything on one screen
    expect(errors).toEqual([]);
    await page.screenshot({ path: `playwright-report/teams-ui/teams-${vp.width}x${vp.height}.png`, fullPage: vp.width < 1280 });
    await ctx.close();
  });
}

// ------------------------------------------------------------------ active-team-count layouts

const H2H: Figs = { panthers: [[5, 7], [3, 5], [2, 2], [1, 1]], sigma: [[4, 8], [3, 4], [1, 3]] }; // Panthers 11 vs Sigma 8
const iso = (ms: number) => new Date(ms).toISOString();

test("two active teams: PANTHERS VS SIGMA head-to-head, leader on the left in gold, Alpha absent everywhere, Top 3 under each", async ({ page }) => {
  const errors = errorsOf(page);
  await display(page, { slugs: TWO, figs: H2H });
  await page.goto("/?screen=teams");
  await expect(page.getByTestId("team-card")).toHaveCount(2, { timeout: 120_000 });
  await expect(page.getByTestId("head-to-head")).toBeVisible();
  await expect(page.getByTestId("arena-screen-title")).toHaveText(/Panthers\s*VS\s*Sigma/i);
  const cards = page.getByTestId("team-card");
  expect(await cards.evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.team, (e as HTMLElement).dataset.rank, (e as HTMLElement).dataset.variant]))).toEqual([["panthers", "1", "hero"], ["sigma", "2", "hero"]]);
  await expect(cards.nth(0)).toHaveAttribute("data-leader", "true");
  await expect(cards.nth(0).getByTestId("team-rank")).toHaveText("1ST");
  await expect(cards.nth(1).getByTestId("team-rank")).toHaveText("2ND");
  await expect(cards.nth(0).getByLabel("Leading team")).toBeVisible();
  const box = await cards.evaluateAll((els) => els.map((e) => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y, w: e.getBoundingClientRect().width, frame: getComputedStyle(e).backgroundImage })));
  expect(box[0].x).toBeLessThan(box[1].x); // leader left
  expect(box[0].y).toBeLessThan(box[1].y); // lifted / forward
  expect(box[0].w).toBeGreaterThan(box[1].w);
  expect(box[0].frame).toContain("rgb(245, 196, 81)");
  expect(box[1].frame).toContain("rgba(201, 209, 224");
  // Both official crests; nothing from the archived team anywhere on screen.
  const crests = await page.locator('[data-testid="team-card"] [data-testid="team-logo"]').evaluateAll((imgs) => imgs.map((i) => [(i as HTMLImageElement).getAttribute("src"), (i as HTMLImageElement).naturalWidth]));
  expect(crests).toEqual([["/teams/team-panthers.webp", 384], ["/teams/team-sigma.webp", 384]]);
  await expect(page.locator('[data-team="alpha"]')).toHaveCount(0);
  await expect(page.getByText("Team Alpha")).toHaveCount(0);
  // VS emblem with the real share of validated sales (11 of 19).
  await expect(page.getByTestId("versus")).toBeVisible();
  await expect(page.getByTestId("versus-split")).toHaveAttribute("data-share", "58");
  // Top 3 per team, directly under its card; Sigma has exactly 3, Panthers' 4th is not shown.
  for (const slug of TWO) {
    const rows = page.locator(`[data-testid="team-column"][data-team="${slug}"] [data-testid="team-board"] [data-testid="member-row"]`);
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rank))).toEqual(["1", "2", "3"]);
  }
  // Overall top performers: only Panthers / Sigma members.
  const top = page.getByTestId("top-performer");
  await expect(top).toHaveCount(3);
  expect(await top.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.user))).toEqual(["UI-PANTHERS-0", "UI-SIGMA-0", "UI-PANTHERS-1"]);
  await page.screenshot({ path: "playwright-report/teams-ui/two-teams-1920x1080.png" });
  expect(errors).toEqual([]);
});

test("two teams: when Sigma overtakes on a genuine update it moves to the left with the lead animation, once", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __lead: number };
    w.__lead = 0;
    let l = false;
    setInterval(() => {
      const nl = !!document.querySelector('[data-testid="lead-takeover"]');
      if (nl && !l) w.__lead++;
      l = nl;
    }, 50);
  });
  const d = await display(page, { slugs: TWO, figs: H2H });
  await page.goto("/?screen=teams");
  await expect(page.getByTestId("team-card").first()).toHaveAttribute("data-team", "panthers", { timeout: 120_000 });
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as unknown as { __lead: number }).__lead)).toBe(0);
  d.st.figs = { ...H2H, sigma: [[9, 10], [3, 4], [1, 3]] }; // Sigma 13 vs Panthers 11
  const now = Date.now();
  d.stream(sse("teams.updated", { reason: "test", at: iso(now) }));
  await expect(page.getByTestId("team-card").first()).toHaveAttribute("data-team", "sigma", { timeout: 20_000 });
  await expect(page.getByTestId("arena-screen-title")).toHaveText(/Sigma\s*VS\s*Panthers/i);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lead: number }).__lead), { timeout: 10_000 }).toBe(1);
  await expect(page.getByTestId("lead-takeover")).toContainText("Team Sigma takes the lead");
  const x = await page.getByTestId("team-card").evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.team, Math.round(e.getBoundingClientRect().x)]));
  expect(Number(x[0][1])).toBeLessThan(Number(x[1][1]));
});

test("two teams tied: neutral, balanced layout, no invented winner", async ({ page }) => {
  await display(page, { slugs: TWO, figs: { panthers: [[3, 5], [1, 2]], sigma: [[2, 4], [2, 3]] } }); // 4 / 7 each
  await page.goto("/?screen=teams");
  await expect(page.getByTestId("team-card")).toHaveCount(2, { timeout: 120_000 });
  const cards = page.getByTestId("team-card");
  for (let i = 0; i < 2; i++) {
    await expect(cards.nth(i)).toHaveAttribute("data-neutral", "true");
    await expect(cards.nth(i)).not.toHaveAttribute("data-leader", "true");
    await expect(cards.nth(i).getByTestId("team-rank")).toHaveText("TIED");
    await expect(cards.nth(i).getByTestId("team-gap")).toHaveText("Level on validated sales");
  }
  await expect(page.getByLabel("Leading team")).toHaveCount(0);
  const box = await cards.evaluateAll((els) => els.map((e) => ({ y: Math.round(e.getBoundingClientRect().y), w: Math.round(e.getBoundingClientRect().width), frame: getComputedStyle(e).backgroundImage })));
  expect(Math.abs(box[0].w - box[1].w)).toBeLessThanOrEqual(2); // balanced
  expect(Math.abs(box[0].y - box[1].y)).toBeLessThanOrEqual(1);
  for (const b of box) expect(b.frame).not.toContain("rgb(245, 196, 81)"); // no gold for anyone
  // Deterministic order for a tie: the Admin display order (Panthers before Sigma).
  expect(await cards.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.team))).toEqual(["panthers", "sigma"]);
  await expect(page.getByTestId("versus-split")).toContainText("All square");
  await expect(page.getByTestId("teams-race-summary")).toContainText("Lead open");
  await page.screenshot({ path: "playwright-report/teams-ui/two-teams-tied.png" });
});

test("a team with fewer than three members shows only its real members (nothing fabricated)", async ({ page }) => {
  await display(page, { slugs: ["panthers", "falcons"], figs: { panthers: [[3, 4], [1, 1]], falcons: [[2, 2]] } });
  await page.goto("/?screen=teams");
  await expect(page.getByTestId("team-card")).toHaveCount(2, { timeout: 120_000 });
  await expect(page.locator('[data-testid="team-board"][data-team="falcons"] [data-testid="member-row"]')).toHaveCount(2); // Falcons has 2 members
  // A team without an uploaded logo still renders (initials plate), no broken image.
  await expect(page.locator('[data-testid="team-card"][data-team="falcons"] [data-testid="team-logo"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="team-card"][data-team="falcons"] [aria-label="Team Falcons"]').first()).toHaveText("FA"); // initials plate
});

test("one active team: spotlight view; five active teams: a grid that keeps every team readable", async ({ page }) => {
  const d = await display(page, { slugs: ["sigma"], figs: { sigma: [[2, 3], [1, 1]] } });
  await page.goto("/?screen=teams");
  await expect(page.getByTestId("spotlight")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("team-card")).toHaveCount(1);
  await expect(page.getByTestId("team-rank")).toHaveText("SPOTLIGHT");
  await expect(page.getByLabel("Leading team")).toHaveCount(0); // no "winner" of a one-team race
  await page.screenshot({ path: "playwright-report/teams-ui/one-team.png" });

  d.st.slugs = ["alpha", "panthers", "sigma", "falcons", "eagles"];
  d.st.figs = { ...MONTH, falcons: [[1, 2]], eagles: [[2, 2]] };
  d.stream(sse("teams.updated", { reason: "test" }));
  await expect(page.getByTestId("teams-grid")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("team-card")).toHaveCount(5);
  const widths = await page.getByTestId("team-card").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  for (const w of widths) expect(w).toBeGreaterThanOrEqual(340); // never unreadably small
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "playwright-report/teams-ui/five-teams.png", fullPage: true });
});

for (const vp of [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
]) {
  test(`two-team layout ${vp.width}×${vp.height}: no overflow, overlaps or clipped text; TV sizes fit one screen`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: vp, reducedMotion: "no-preference" });
    const page = await ctx.newPage();
    const errors = errorsOf(page);
    await display(page, { slugs: TWO, figs: H2H, cub: false });
    await page.goto("/?screen=teams");
    await expect(page.getByTestId("team-card")).toHaveCount(2, { timeout: 120_000 });
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const all = (sel: string) => [...document.querySelectorAll(sel)];
      const blocks = [...all('[data-testid="team-card"]'), ...all('[data-testid="team-board"]'), ...all('[data-testid="versus"]'), ...all('[data-testid="teams-top3"]')].map((e) => e.getBoundingClientRect());
      let overlaps = 0;
      for (let i = 0; i < blocks.length; i++)
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i], b = blocks[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++;
        }
      const clipped = all('[data-testid="team-card"] h2, [data-testid="team-validated"], [data-testid="team-submitted"], [data-testid="team-rate"], [data-testid="member-validated"], [data-testid="member-row"] [title], [data-testid="arena-screen-title"]')
        .filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1)
        .map((e) => e.textContent);
      const cards = all('[data-testid="team-card"]').map((e) => e.getBoundingClientRect());
      return { overflowX: document.documentElement.scrollWidth - innerWidth, overlaps, clipped, cardsBottom: Math.max(...cards.map((c) => c.bottom)), boardsBottom: Math.max(...all('[data-testid="team-board"]').map((e) => e.getBoundingClientRect().bottom)), lowest: Math.max(...blocks.map((b) => b.bottom)), cardShare: cards.reduce((s, c) => s + c.width, 0) / innerWidth };
    });
    expect(m.overflowX).toBeLessThanOrEqual(1);
    expect(m.overlaps).toBe(0);
    expect(m.clipped).toEqual([]);
    expect(m.cardShare).toBeGreaterThan(0.75); // the two cards dominate the display
    expect(m.boardsBottom).toBeLessThanOrEqual(vp.height); // both teams' cards and Top 3 always on the first screen
    if (vp.width >= 1600) expect(m.lowest).toBeLessThanOrEqual(vp.height); // TV sizes: everything incl. top performers
    expect(errors).toEqual([]);
    await page.screenshot({ path: `playwright-report/teams-ui/two-teams-${vp.width}x${vp.height}.png` });
    await ctx.close();
  });
}
