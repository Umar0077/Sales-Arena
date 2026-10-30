import { test, expect, type Page } from "@playwright/test";
import { open, liveDataConfigured } from "./helpers";

test.use({ contextOptions: { reducedMotion: "no-preference" } });

const storage = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}").state, key);

/** Close any bonus or spin popups that are showing (several can queue up). */
async function clearPopups(arena: Page) {
  for (let i = 0; i < 8; i++) {
    await arena.waitForTimeout(700);
    const bonus = arena.getByTestId("bonus-popup");
    const spin = arena.getByRole("button", { name: /Spin later/ });
    if (await bonus.count()) await bonus.getByRole("button", { name: "Close" }).click();
    else if (await spin.count()) await spin.click();
    else return;
  }
}

test("Daily, Weekly, Monthly and Spin & Win arenas, driven from the Admin Panel", async ({ context }) => {
  const probe = await context.newPage();
  test.skip(await liveDataConfigured(probe), "Uses the browser demo-data simulator; live bonuses come from the server (integration tests).");
  await probe.close();
  test.setTimeout(180_000);
  const shots = process.env.SHOTS_DIR;
  const arena = await context.newPage();
  await open(arena, "/");
  const admin = await context.newPage();

  // 1–4. Reward Programs: Daily bonus 1 validated sale = Rs. 1,000, Daily Arena as default screen.
  await open(admin, "/admin/programs");
  await admin.getByRole("tab", { name: "Daily Rewards" }).click();
  await admin.getByTestId("prog-daily-salesRequired").fill("1");
  await admin.getByTestId("prog-daily-amount").fill("1000");
  const enabled = admin.getByRole("switch", { name: "Campaign enabled" });
  if ((await enabled.getAttribute("aria-checked")) !== "true") await enabled.click();
  await admin.getByRole("tab", { name: "Arena Display" }).click();
  await admin.getByLabel("Default screen").selectOption("daily");
  // Let one validated sale count for daily, weekly and monthly programs together (opt-in).
  const together = admin.getByRole("switch", { name: "Programs run at the same time" });
  if ((await together.getAttribute("aria-checked")) !== "true") await together.click();
  if (shots) await admin.screenshot({ path: `${shots}/rp-admin.png` });

  // 5–7. Live Arena shows the Daily screen: Top 3 Weekly above Latest Sales & Achievements.
  await arena.bringToFront();
  await expect(arena.getByTestId("arena-screen-title")).toHaveText("Today's Bonus Floor", { timeout: 10_000 });
  await expect(arena.getByTestId("campaign-rule")).toContainText("1 validated sale = Rs. 1,000");
  const top3 = arena.getByTestId("top3-weekly");
  await expect(top3).toBeVisible();
  await expect(top3.locator("li")).toHaveCount(3);
  const topBox = await top3.boundingBox();
  const salesBox = await arena.getByText("LATEST SALES").boundingBox();
  expect(salesBox!.y).toBeGreaterThan(topBox!.y + topBox!.height - 1);
  if (shots) await arena.screenshot({ path: `${shots}/rp-daily.png`, fullPage: true });

  // 11. A pending lead does not trigger a bonus.
  await open(admin, "/admin/arena");
  const agentName = (await admin.getByTestId("sim-agent").locator("option:checked").innerText()).split(" — ")[0];
  const agentId = await admin.getByTestId("sim-agent").inputValue();
  const first = agentName.split(" ")[0].toUpperCase();
  await admin.getByTestId("sim-submit-lead").click();
  await arena.bringToFront();
  await arena.waitForTimeout(2000);
  await expect(arena.getByTestId("bonus-popup")).toHaveCount(0);

  // 8–10. A validated sale gives that agent the daily bonus popup.
  await admin.bringToFront();
  await admin.getByTestId("sim-approve-one").click();
  await arena.bringToFront();
  const popup = arena.locator("[data-testid=bonus-popup][data-kind=daily]");
  await expect(popup).toBeVisible({ timeout: 10_000 });
  await expect(popup).toContainText(`CONGRATULATIONS, ${first}!`);
  await expect(popup).toContainText("YOUR SALE HAS BEEN VALIDATED!");
  await expect(popup.getByTestId("bonus-reward-line")).toHaveText("YOU'VE EARNED RS. 1,000 DAILY BONUS!");
  await arena.waitForTimeout(1500);
  if (shots) await arena.screenshot({ path: `${shots}/rp-daily-popup.png` });

  // 19. Exactly one daily award for that one validated sale (and the pending lead gave none).
  const rewards = await storage(arena, "sales-arena:reward-programs");
  const daily = (rewards.awards as Array<{ programId: string; agentId: string }>).filter((a) => a.programId === "prog_daily" && a.agentId === agentId);
  expect(daily).toHaveLength(1);
  await clearPopups(arena);
  await expect(arena.getByText(new RegExp(`${agentName} earned Rs\\. 1,000`)).first()).toBeVisible();

  // 12–13. Admin switches the Live Arena to Weekly.
  await open(admin, "/admin/programs");
  await admin.getByTestId("switch-weekly").click();
  await arena.bringToFront();
  await expect(arena.getByTestId("arena-screen-title")).toHaveText("This Week's Race", { timeout: 10_000 });
  await expect(arena.getByTestId("board-period")).toHaveText("This Week");
  expect(Number((await arena.getByTestId("period-validated").innerText()).replace(/,/g, ""))).toBeGreaterThan(0);
  await expect(arena.getByTestId("top3-weekly")).toBeVisible();
  await arena.waitForTimeout(800);
  if (shots) await arena.screenshot({ path: `${shots}/rp-weekly.png` });

  // 18. Changing a reward setting updates the view.
  await admin.bringToFront();
  await admin.getByRole("tab", { name: "Weekly Rewards" }).click();
  await admin.getByTestId("prog-weekly-salesRequired").fill("7");
  await arena.bringToFront();
  await expect(arena.getByTestId("campaign-rule")).toContainText("7 validated sales", { timeout: 10_000 });

  // 14–15. Monthly.
  await admin.bringToFront();
  await admin.getByRole("tab", { name: "Arena Display" }).click();
  await admin.getByTestId("switch-monthly").click();
  await arena.bringToFront();
  await expect(arena.getByTestId("arena-screen-title")).toHaveText("This Month's Championship", { timeout: 10_000 });
  await expect(arena.getByTestId("board-period")).toHaveText("This Month");
  const monthValidated = Number((await arena.getByTestId("period-validated").innerText()).replace(/,/g, ""));
  await arena.waitForTimeout(800);
  if (shots) await arena.screenshot({ path: `${shots}/rp-monthly.png` });

  // 16–17. Spin & Win still works.
  await admin.bringToFront();
  await admin.getByTestId("switch-spin").click();
  await arena.bringToFront();
  await expect(arena.getByTestId("arena-screen-title")).toHaveCount(0, { timeout: 10_000 });
  await expect(arena.getByTestId("board-period")).toHaveText("Today");
  await arena.getByTestId("demo-spin").click();
  const spinPopup = arena.getByRole("dialog", { name: /CONGRATULATIONS/ }).filter({ has: arena.getByRole("button", { name: "SPIN NOW" }) });
  // The demo's validated sales also earn daily bonuses; those popups queue first, then the spin popup.
  for (let i = 0; i < 25 && !(await spinPopup.count()); i++) {
    const bonus = arena.getByTestId("bonus-popup");
    if (await bonus.count()) await bonus.getByRole("button", { name: "Close" }).click().catch(() => {});
    await arena.waitForTimeout(700);
  }
  await expect(spinPopup).toBeVisible({ timeout: 15_000 });
  await spinPopup.getByRole("button", { name: "SPIN NOW" }).click();
  await arena.getByTestId("spin-button").click();
  await expect(arena.locator("[data-reveal-state]")).toHaveAttribute("data-reveal-state", "holding", { timeout: 30_000 });
  await expect(arena.locator("[data-reveal-state]")).toHaveCount(0, { timeout: 12_000 });

  // The on-screen selector also switches screens.
  await clearPopups(arena);
  await arena.getByRole("tab", { name: "Monthly Arena" }).click();
  await expect(arena.getByTestId("arena-screen-title")).toHaveText("This Month's Championship");
  expect(Number((await arena.getByTestId("period-validated").innerText()).replace(/,/g, ""))).toBeGreaterThanOrEqual(monthValidated);

  // 20. Phone layout: selector becomes a dropdown, no sideways scrolling.
  await arena.setViewportSize({ width: 390, height: 844 });
  await expect(arena.locator("#arena-mode-select")).toBeVisible();
  await arena.locator("#arena-mode-select").selectOption("daily");
  await expect(arena.getByTestId("arena-screen-title")).toHaveText("Today's Bonus Floor");
  expect(await arena.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await arena.evaluate(() => getComputedStyle(document.querySelector("h1")!).fontFamily)).toMatch(/Sora/);
});
