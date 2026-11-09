import { test, expect, type Page } from "@playwright/test";
import { display } from "./teams-ui-helpers";

/**
 * Visual check of the Daily, Weekly and Monthly arenas at 1080p with SAFE TEST FIXTURES only (no database, no
 * Safe Quote): one, two and three agents. Screenshots go to test-results/arena-visual/<label>/ (label from
 * ARENA_SHOT_LABEL, e.g. "before" / "after"). It also checks that names, counts and rows are not clipped.
 */
test.describe.configure({ timeout: 180_000 });
const LABEL = process.env.ARENA_SHOT_LABEL ?? "after";
const DIR = `${process.env.ARENA_SHOT_DIR ?? "test-results/arena-visual"}/${LABEL}`;

type Fx = { code: string; name: string; submitted: number; validated: number };
const FIXTURES: Fx[] = [
  { code: "UI-A", name: "Arsam Idrees", submitted: 31, validated: 23 },
  { code: "UI-B", name: "Syed Noroz Ali Kazmi", submitted: 27, validated: 17 },
  { code: "UI-C", name: "Kanwal Farooq", submitted: 22, validated: 12 },
];
const row = (f: Fx, i: number) => ({
  agent: { id: `agt_${f.code}`, name: f.name, initials: f.name.split(" ").slice(0, 2).map((p) => p[0]).join(""), teamId: "fe", campaignId: "cmp_fe", active: true, userCode: f.code },
  code: f.code,
  teamId: "fe",
  counts: { submitted: f.submitted, validated: f.validated, pending: 0, rejected: 0, duplicate: 0 },
  rate: (f.validated / f.submitted) * 100,
  rank: i + 1,
});

async function arena(page: Page, n: number) {
  const fx = FIXTURES.slice(0, n);
  const validated = fx.reduce((t, f) => t + f.validated, 0);
  const submitted = fx.reduce((t, f) => t + f.submitted, 0);
  const summary = { range: { from: null, to: null }, submitted, validated, closeRate: submitted ? (validated / submitted) * 100 : 0, returned: 2, rejected: 1, activeClosers: n, premium: { total: validated * 96, average: 96 } };
  await display(page, { values: { celebrationPopups: false } });
  await page.route("**/api/arena/summary**", (r) => r.fulfill({ json: { ok: true, mode: "production", data: summary } }));
  await page.route("**/api/arena/closers**", (r) => r.fulfill({ json: { ok: true, closers: fx.map(row) } }));
  await page.route("**/api/arena/recent-sales**", (r) => r.fulfill({ json: { ok: true, sales: [] } }));
  await page.route("**/api/arena/awards", (r) =>
    r.fulfill({ json: { ok: true, awards: [], summary: { daily: { earned: 0, count: 0, currency: "PKR" }, weekly: { earned: 0, count: 0, currency: "PKR" }, monthly: { earned: 0, count: 0, currency: "PKR" } } } }),
  );
}

async function noClipping(page: Page) {
  // Names and numbers in the podium and the leaderboard show in full (or with a title for an ellipsis), and nothing
  // important is covered by the Arena Cub.
  const issues = await page.evaluate(() => {
    const out: string[] = [];
    const cub = document.querySelector("[data-testid='arena-cub']")?.getBoundingClientRect();
    for (const el of document.querySelectorAll<HTMLElement>("[data-col], [data-testid='closer-rows'] li, [data-testid^='top3-'] li")) {
      if (el.scrollWidth > el.clientWidth + 1 && !el.title && el.matches("[data-col]")) out.push(`clipped: ${el.textContent}`);
      const r = el.getBoundingClientRect();
      if (cub && r.width && cub.width && !(cub.right < r.left || cub.left > r.right || cub.bottom < r.top || cub.top > r.bottom) && el.closest("[data-testid='closer-rows']"))
        out.push(`covered by cub: ${el.textContent?.slice(0, 40)}`);
    }
    return out;
  });
  expect(issues).toEqual([]);
}

for (const n of [1, 2, 3]) {
  for (const screen of ["daily", "weekly", "monthly"] as const) {
    test(`${screen} with ${n} agent${n > 1 ? "s" : ""} at 1080p`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await arena(page, n);
      await page.goto(`/?screen=${screen}`);
      await expect(page.locator(`[data-arena-mode="${screen}"]`)).toBeVisible({ timeout: 120_000 });
      await expect(page.locator("[data-testid='closer-rows'] li[data-code]")).toHaveCount(n, { timeout: 30_000 });
      await page.waitForTimeout(2500); // counters and entrance animations settle
      await page.screenshot({ path: `${DIR}/${screen}-${n}.png`, timeout: 45_000 });
      await noClipping(page);
    });
  }
}
