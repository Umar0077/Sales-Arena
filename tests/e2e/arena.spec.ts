import { test, expect } from "@playwright/test";
import { open } from "./helpers";

test.describe("Sales Arena routes", () => {
  test("Live Arena at / shows KPIs, feeds and the right-side leaderboard", async ({ page }) => {
    await open(page, "/");
    await expect(page).toHaveTitle(/FE Sales Arena|SALES ARENA/i);
    await expect(page.getByText("LIVE ARENA", { exact: true })).toBeVisible();
    await expect(page.getByText("APPROVED SALES").first()).toBeVisible();
    await expect(page.getByText("LATEST SALES")).toBeVisible();
    const board = page.getByRole("region", { name: "Leaderboard" });
    await expect(board).toBeVisible();

    // Leaderboard sits to the right of the main column on desktop.
    const boardBox = await board.boundingBox();
    const kpiBox = await page.getByText("APPROVED SALES").first().boundingBox();
    expect(boardBox!.x).toBeGreaterThan(kpiBox!.x + kpiBox!.width);
  });

  test("public header has no admin, leaderboard, dashboard or spin links", async ({ page }) => {
    await open(page, "/");
    const header = page.locator("header").first();
    for (const href of ["/admin", "/leaderboard", "/agent", "/spin", "/demo"]) {
      await expect(header.locator(`a[href="${href}"]`)).toHaveCount(0);
    }
  });

  test("old public pages redirect", async ({ page }) => {
    for (const [from, to] of [["/arena", "/"], ["/leaderboard", "/"], ["/spin", "/"], ["/agent", "/admin/performance"], ["/demo", "/admin/arena"]]) {
      await page.goto(from);
      await expect(page).toHaveURL(new RegExp(`${to.replace("/", "\\/")}$`));
    }
  });

  test("Admin Panel has its own layout with all 12 sections", async ({ page }) => {
    await open(page, "/admin");
    const nav = page.getByRole("navigation", { name: "Admin" }).first();
    for (const label of [
      "Overview Dashboard", "Reward Programs", "Live Arena Controls", "Agent Management", "Sales & Performance", "Target Management",
      "Spin & Rewards", "Leaderboard Settings", "Celebration Settings", "Spin History", "Appearance & Sound", "Integration Preview",
    ]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    // The FE campaign has no team hierarchy (closers are individual userCodes)
    await expect(nav.getByRole("link", { name: "Team Management" })).toHaveCount(0);
    // Public Live Arena header is not part of the admin shell.
    await expect(page.getByText("LIVE ARENA", { exact: true })).toHaveCount(0);
  });

  test("every admin page loads", async ({ page }) => {
    for (const path of ["/admin", "/admin/arena", "/admin/agents", "/admin/teams", "/admin/performance", "/admin/targets", "/admin/rewards", "/admin/leaderboard", "/admin/celebrations", "/admin/spins", "/admin/settings", "/admin/integrations"]) {
      await open(page, path);
      await expect(page.locator("main")).not.toBeEmpty();
    }
  });

  test("Sora is the page font", async ({ page }) => {
    await open(page, "/");
    await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible();
    const fonts = await page.evaluate(() => {
      const selectors = ["body", "h1, h2, h3", "button"];
      return selectors.map((sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).fontFamily : "";
      });
    });
    for (const f of fonts) {
      if (f) expect(f).toMatch(/Sora/);
    }
    expect(fonts[0]).toMatch(/Sora/);
  });

  test("admin settings persist after reload", async ({ page }) => {
    await open(page, "/admin/leaderboard");
    await page.getByRole("radio", { name: "Compact" }).click();
    await page.reload();
    await expect(page.getByText("Loading live data…")).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByRole("radio", { name: "Compact" })).toHaveAttribute("aria-checked", "true");
  });
});

test("admin can switch the Live Arena off and on", async ({ context }) => {
  const shots = process.env.SHOTS_DIR;
  const arena = await context.newPage();
  await open(arena, "/");
  const admin = await context.newPage();
  await open(admin, "/admin/arena");
  await expect(admin.getByTestId("arena-status")).toHaveText(/ON AIR/);
  if (shots) await admin.screenshot({ path: `${shots}/admin-arena-switch.png` });

  await admin.getByRole("switch", { name: "Live Arena on" }).click();
  await expect(admin.getByTestId("arena-status")).toHaveText(/OFF AIR/);
  await arena.bringToFront();
  await expect(arena.getByTestId("arena-offline")).toBeVisible({ timeout: 5000 });
  await expect(arena.getByRole("region", { name: "Leaderboard" })).toHaveCount(0);
  await expect(arena.getByTestId("demo-spin")).toHaveCount(0);
  if (shots) await arena.screenshot({ path: `${shots}/arena-offline.png` });

  await admin.bringToFront();
  await admin.getByRole("switch", { name: "Live Arena on" }).click();
  await arena.bringToFront();
  await expect(arena.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 5000 });
});

test("Powered by Go Connectivo badge shows on every page", async ({ page }) => {
  for (const path of ["/", "/admin", "/admin/arena", "/admin/settings"]) {
    await open(page, path);
    const badge = page.getByLabel("Powered by Go Connectivo").filter({ visible: true }).first();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("GO");
    await expect(badge).toContainText("CONNECTIVO");
  }
});
