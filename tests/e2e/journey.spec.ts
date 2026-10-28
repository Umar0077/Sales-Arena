import { test, expect, type Page } from "@playwright/test";
import { open } from "./helpers";

/**
 * The full agent journey from the brief:
 * admin sets 2 sales per spin → 2 approved sales → SPIN NOW popup → 3D spin →
 * prize reveal → automatic return to the Live Arena 4 s after the reveal is fully shown.
 */
test.use({ contextOptions: { reducedMotion: "no-preference" } });

async function storedData(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("sales-arena:data") || "{}").state);
}

test("target completion → spin → prize → back to Live Arena", async ({ context }) => {
  test.setTimeout(120_000);
  const shots = process.env.SHOTS_DIR;

  const arena = await context.newPage();
  await open(arena, "/");
  await expect(arena.getByRole("region", { name: "Leaderboard" })).toBeVisible();

  // 1. Admin sets every target rule to 2 approved sales per spin.
  const admin = await context.newPage();
  await open(admin, "/admin/targets");
  const edits = admin.getByRole("button", { name: "Edit rule" });
  const ruleCount = await edits.count();
  expect(ruleCount).toBeGreaterThan(0);
  for (let i = 0; i < ruleCount; i++) {
    await edits.nth(i).click();
    const input = admin.locator("form input[type='number']").first();
    await input.fill("2");
    await admin.getByRole("button", { name: "Save Rule" }).click();
    await expect(admin.locator("form")).toHaveCount(0);
  }
  const rules = (await storedData(admin)).targetRules as Array<{ salesPerSpin: number }>;
  expect(rules.every((r) => r.salesPerSpin === 2)).toBe(true);

  // 2. Pick an agent who needs exactly 2 more sales for the next spin.
  await open(admin, "/admin/arena");
  const select = admin.getByTestId("sim-agent");
  const ids = await select.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  let agentId = "";
  for (const id of ids) {
    await select.selectOption(id);
    if ((await admin.getByTestId("sim-next-spin-in").innerText()).trim() === "2") {
      agentId = id;
      break;
    }
  }
  expect(agentId).not.toBe("");
  const agentName = (await select.locator(`option[value="${agentId}"]`).innerText()).split(" — ")[0];
  const firstName = agentName.split(" ")[0].toUpperCase();
  const spinsBefore = Number(await admin.getByTestId("sim-spins-available").innerText());

  // 3. First approved sale: no spin yet.
  await admin.getByTestId("sim-approve-one").click();
  await arena.waitForTimeout(2000);
  await expect(arena.getByRole("dialog", { name: /CONGRATULATIONS/ })).toHaveCount(0);

  // 4. Second approved sale: the achievement popup appears on the Live Arena.
  await arena.bringToFront();
  await admin.getByTestId("sim-approve-one").click();
  const popup = arena.getByRole("dialog", { name: new RegExp(`CONGRATULATIONS, ${firstName}`) });
  await expect(popup).toBeVisible({ timeout: 10_000 });
  await expect(popup).toContainText(/completed \d+ approved sales/);
  await expect(popup).toContainText(/earned \d+ Spins?/);
  await arena.waitForTimeout(900);
  if (shots) await arena.screenshot({ path: `${shots}/journey-1-popup.png`, timeout: 45_000 });

  await admin.close(); // free the renderer for the 3D stage
  await arena.bringToFront(); // a TV display is the visible tab (background tabs throttle timers)

  // 5. SPIN NOW → spin stage for the same agent.
  await popup.getByRole("button", { name: "SPIN NOW" }).click();
  await expect(arena.getByTestId("spin-agent-name")).toHaveText(agentName, { timeout: 10_000 });
  await expect(arena.getByTestId("spins-available")).toHaveText(String(spinsBefore + 1));
  await arena.waitForTimeout(2500);
  if (shots) await arena.screenshot({ path: `${shots}/journey-2-stage.png`, timeout: 45_000 });

  // Record, in page time, when the reveal is fully shown and when it closes
  // (so slow test screenshots don't distort the 4-second measurement).
  await arena.evaluate(() => {
    const w = window as unknown as { __reveal: { held?: number; closed?: number } };
    w.__reveal = {};
    new MutationObserver(() => {
      const el = document.querySelector("[data-reveal-state]");
      if (el?.getAttribute("data-reveal-state") === "holding" && !w.__reveal.held) w.__reveal.held = performance.now();
      if (!el && w.__reveal.held && !w.__reveal.closed) w.__reveal.closed = performance.now();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-reveal-state"] });
  });

  // 6. Spin; double clicks must not start two spins.
  const spinBtn = arena.getByTestId("spin-button");
  await spinBtn.click();
  await spinBtn.click({ force: true }).catch(() => {});
  await expect(spinBtn).toContainText(/CHARGING|SPINNING|SLOWING/);
  await arena.waitForTimeout(4500);
  if (shots) await arena.screenshot({ path: `${shots}/journey-3-spinning.png`, timeout: 45_000 });

  // 7. Prize reveal; the 4-second hold starts once it is fully shown.
  const reveal = arena.locator("[data-reveal-state]");
  await expect(reveal).toBeVisible({ timeout: 20_000 });
  await expect(reveal).toHaveAttribute("data-reveal-state", "holding", { timeout: 5000 });
  await expect(reveal).toContainText(`CONGRATULATIONS, ${firstName}`);
  const prizeLine = await reveal.locator("p", { hasText: "YOU WON" }).innerText();
  if (shots) await arena.screenshot({ path: `${shots}/journey-4-reveal.png`, timeout: 45_000 });

  await expect(reveal).toHaveCount(0, { timeout: 10_000 });
  const t = await arena.evaluate(() => (window as unknown as { __reveal: { held: number; closed: number } }).__reveal);
  const shownFor = (t.closed - t.held) / 1000;
  console.log(`Reveal held for ${shownFor.toFixed(2)}s before closing`);
  // 4 s hold + the ~0.45 s exit fade.
  expect(shownFor).toBeGreaterThan(3.9);
  expect(shownFor).toBeLessThan(5.2);

  // 8. Back on the Live Arena with the result saved exactly once.
  await expect(arena.getByTestId("spin-agent-name")).toHaveCount(0, { timeout: 5000 });
  await expect(arena.getByRole("region", { name: "Leaderboard" })).toBeVisible();
  const data = await storedData(arena);
  const agentSpins = (data.spins as Array<{ agentId: string; rewardTitle: string; status: string; createdAt: string }>).filter(
    (s) => s.agentId === agentId && Date.now() - new Date(s.createdAt).getTime() < 60_000,
  );
  expect(agentSpins).toHaveLength(1);
  expect(agentSpins[0].status).toBe("completed");
  expect(prizeLine.toUpperCase()).toContain(agentSpins[0].rewardTitle.toUpperCase());
  await expect(arena.getByText(`${agentName} won ${agentSpins[0].rewardTitle}`).first()).toBeVisible();
  if (shots) await arena.screenshot({ path: `${shots}/journey-5-back.png`, timeout: 45_000 });

  // 9. Persistence after refresh.
  const salesBefore = (data.sales as Array<{ agentId: string; status: string }>).filter((s) => s.agentId === agentId && s.status === "approved").length;
  await arena.reload();
  await expect(arena.getByText("Loading live data…")).toHaveCount(0, { timeout: 15000 });
  const after = await storedData(arena);
  expect((after.sales as Array<{ agentId: string; status: string }>).filter((s) => s.agentId === agentId && s.status === "approved").length).toBe(salesBefore);
  expect((after.spins as Array<{ agentId: string }>).filter((s) => s.agentId === agentId).length).toBeGreaterThanOrEqual(1);
  await expect(arena.getByRole("dialog", { name: /CONGRATULATIONS/ })).toHaveCount(0);
});

test("Demo spin button runs the whole journey from the Live Arena", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, "/");
  await page.getByTestId("demo-spin").click();
  const popup = page.getByRole("dialog", { name: /CONGRATULATIONS/ });
  await expect(popup).toBeVisible({ timeout: 10_000 });
  await expect(popup).toContainText(/earned \d+ Spins?/);
  await popup.getByRole("button", { name: "SPIN NOW" }).click();
  await page.getByTestId("spin-button").click();
  const reveal = page.locator("[data-reveal-state]");
  await expect(reveal).toHaveAttribute("data-reveal-state", "holding", { timeout: 25_000 });
  await expect(reveal).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible();
  await expect(page.getByTestId("demo-spin")).toBeEnabled();
});
