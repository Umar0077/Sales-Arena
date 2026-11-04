import { test, expect, type Page } from "@playwright/test";

/**
 * Admin sidebar navigation must keep working on every page, especially Celebration Settings with the
 * Arena Cub Preview Studio (regression: an endless render loop there blocked every sidebar click).
 * Read-only: nothing is saved (the Allow confirmation is cancelled).
 */

const PAGES = {
  dashboard: { href: "/admin", label: "Overview Dashboard" },
  celebrations: { href: "/admin/celebrations", label: "Celebration Settings" },
  programs: { href: "/admin/programs", label: "Reward Programs" },
  agents: { href: "/admin/agents", label: "Agent Management" },
  spinMgmt: { href: "/admin/spin-management", label: "Spin Management" },
  arena: { href: "/admin/arena", label: "Live Arena Controls" },
} as const;
type Key = keyof typeof PAGES;

function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !/Failed to load resource/.test(t)) problems.push(`console: ${t.slice(0, 200)}`);
    if (/Maximum update depth|unmounted component|Cannot update a component/i.test(t)) problems.push(`react: ${t.slice(0, 200)}`);
  });
  return problems;
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

/** The sidebar link (desktop) or the drawer link (mobile), checked to be the topmost element under the pointer. */
async function navTo(page: Page, key: Key) {
  const { href, label } = PAGES[key];
  if (isMobile(page)) {
    // A tap before the page has hydrated is lost: tap again until the drawer is open.
    const drawer = page.getByRole("dialog", { name: "Admin navigation" });
    await expect(async () => {
      if (!(await drawer.isVisible())) await page.getByRole("button", { name: "Open menu" }).click();
      await expect(drawer).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
  }
  const link = page.locator(`a[href="${href}"]:visible`).filter({ hasText: label }).first();
  await expect(link).toBeVisible();
  const box = (await link.boundingBox())!;
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href") ?? null, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit, `nothing may cover the "${label}" link`).toBe(href);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replace(/\//g, "\\/")}$`), { timeout: 15_000 });
  await expect(page.locator(`a[href="${href}"][aria-current="page"]`).first()).toBeAttached();
}

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }] as const) {
  test.describe(`Admin navigation (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, contextOptions: { reducedMotion: "no-preference" } });
    test.describe.configure({ timeout: 240_000 });

    test("sidebar works to and from Celebration Settings, repeatedly, with Back/Forward", async ({ page }) => {
      const problems = watch(page);
      await page.goto("/admin");
      await expect(page.locator('a[href="/admin"][aria-current="page"]').first()).toBeAttached({ timeout: 30_000 });
      await navTo(page, "celebrations");
      await expect(page.getByTestId("arena-cub-settings")).toBeVisible({ timeout: 30_000 });
      await navTo(page, "dashboard");
      for (const k of ["programs", "agents", "spinMgmt", "arena"] as const) {
        await navTo(page, "celebrations");
        await expect(page.getByTestId("cub-preview-stage")).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(1500); // let the preview settle (the loop showed up right after load)
        await navTo(page, k);
      }
      // Several round trips in a row.
      for (let i = 0; i < 3; i++) {
        await navTo(page, "celebrations");
        await navTo(page, "programs");
      }
      // Browser Back / Forward.
      await page.goBack();
      await expect(page).toHaveURL(/\/admin\/celebrations$/);
      await expect(page.getByTestId("arena-cub-settings")).toBeVisible({ timeout: 30_000 });
      await page.goForward();
      await expect(page).toHaveURL(/\/admin\/programs$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/admin\/celebrations$/);
      await navTo(page, "agents");
      expect(problems).toEqual([]);
    });

    test("navigation works while a preview animation plays, after Show/Hide Preview and after a confirmation dialog", async ({ page }) => {
      const problems = watch(page);
      await page.goto("/admin/celebrations");
      await expect(page.getByTestId("cub-preview-stage")).toBeVisible({ timeout: 30_000 });

      // While the cub runs across the preview stage.
      await page.getByRole("button", { name: "Preview Run Across Screen" }).click();
      await expect(page.getByTestId("cub-preview")).toHaveAttribute("data-pose", "run", { timeout: 5000 });
      await navTo(page, "programs");
      await navTo(page, "celebrations");

      // During the greeting and the dance.
      for (const label of ["Preview Greeting", "Preview Dance", "Preview Playful Backflip"]) {
        await page.getByRole("button", { name: label, exact: true }).click();
        await page.waitForTimeout(400);
        await navTo(page, "dashboard");
        await navTo(page, "celebrations");
      }

      // Hide / Show the private preview.
      await page.getByTestId("cub-preview-hide").click();
      await navTo(page, "agents");
      await navTo(page, "celebrations");
      await page.getByTestId("cub-preview-show").click();
      await expect(page.getByTestId("cub-preview")).toBeVisible();
      await navTo(page, "spinMgmt");
      await navTo(page, "celebrations");

      // Open and close a confirmation dialog (cancelled: nothing saved).
      const allow = page.getByTestId("cub-allow-live");
      if (await allow.isVisible()) {
        await allow.click();
        await expect(page.getByTestId("cub-allow-confirm")).toBeVisible();
        await page.getByTestId("cub-allow-confirm").getByRole("button", { name: "Cancel" }).click();
        await expect(page.getByTestId("cub-allow-confirm")).toHaveCount(0);
      }
      await navTo(page, "arena");
      expect(problems).toEqual([]);
    });

    test("the preview stage never extends over the sidebar or the page header", async ({ page }) => {
      await page.goto("/admin/celebrations");
      await expect(page.getByTestId("cub-preview-stage")).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Preview Run Left" }).click();
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => {
        const stage = document.querySelector('[data-testid="cub-preview-stage"]')!.getBoundingClientRect();
        const cub = document.querySelector('[data-testid="cub-preview-root"]')?.getBoundingClientRect();
        const aside = document.querySelector("aside")?.getBoundingClientRect();
        const overflow = getComputedStyle(document.querySelector('[data-testid="cub-preview-stage"]')!).overflow;
        const pe = cub ? getComputedStyle(document.querySelector('[data-testid="cub-preview-root"]')!).pointerEvents : "none";
        return { stageLeft: stage.left, asideRight: aside && aside.width ? aside.right : 0, overflow, pe, fixed: document.querySelectorAll('[data-testid="cub-preview-root"].fixed').length };
      });
      expect(r.overflow).toBe("hidden"); // animations stay inside the preview box
      expect(r.pe).toBe("none"); // decorative layer never takes clicks
      expect(r.fixed).toBe(0); // never a page-level fixed layer
      expect(r.stageLeft).toBeGreaterThanOrEqual(r.asideRight);
    });
  });
}
