import { test, expect, type Page } from "@playwright/test";
import { open } from "./helpers";

test.use({ contextOptions: { reducedMotion: "no-preference" } });

async function setAllRulesTo(admin: Page, n: number) {
  await open(admin, "/admin/targets");
  const edits = admin.getByRole("button", { name: "Edit rule" });
  const count = await edits.count();
  for (let i = 0; i < count; i++) {
    await edits.nth(i).click();
    await admin.locator("form input[type='number']").first().fill(String(n));
    await admin.getByRole("button", { name: "Save Rule" }).click();
    await expect(admin.locator("form")).toHaveCount(0);
  }
}

const stat = (admin: Page, id: string) => admin.getByTestId(id).innerText().then((t) => t.trim());

test("only validated sales unlock spins; status changes update the leaderboard", async ({ context }) => {
  test.setTimeout(120_000);
  const shots = process.env.SHOTS_DIR;
  const arena = await context.newPage();
  await open(arena, "/");
  const admin = await context.newPage();
  await setAllRulesTo(admin, 2);

  // Agent who needs exactly 2 validated sales for the next spin.
  await open(admin, "/admin/arena");
  const select = admin.getByTestId("sim-agent");
  const ids = await select.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  let agentId = "";
  for (const id of ids) {
    await select.selectOption(id);
    if ((await stat(admin, "sim-next-spin-in")) === "2") {
      agentId = id;
      break;
    }
  }
  expect(agentId).not.toBe("");
  const before = { submitted: Number(await stat(admin, "sim-submitted-leads")), validated: Number(await stat(admin, "sim-validated")), spins: await stat(admin, "sim-spins-available") };

  // 3 pending + 1 rejected + 1 duplicate: 5 submitted, still 0 new validated → no spin.
  for (let i = 0; i < 3; i++) await admin.getByTestId("sim-submit-lead").click();
  await admin.getByTestId("sim-reject-lead").click();
  await admin.getByTestId("sim-duplicate-lead").click();
  await expect(admin.getByTestId("sim-submitted-leads")).toHaveText(String(before.submitted + 5));
  await expect(admin.getByTestId("sim-validated")).toHaveText(String(before.validated));
  await expect(admin.getByTestId("sim-spins-available")).toHaveText(before.spins);
  await expect(admin.getByTestId("sim-next-spin-in")).toHaveText("2");

  // + 1 validated → still no spin.
  await admin.getByTestId("sim-approve-one").click();
  await expect(admin.getByTestId("sim-next-spin-in")).toHaveText("1");
  await arena.bringToFront();
  await arena.waitForTimeout(1500);
  await expect(arena.getByRole("dialog", { name: /CONGRATULATIONS/ })).toHaveCount(0);

  // Validate one of the pending leads from the admin list → 2nd validated sale → popup.
  await admin.bringToFront();
  const pendingRow = admin.getByTestId("sim-leads").locator("li[data-status=pending]").first();
  await pendingRow.getByLabel("Change lead status").selectOption("approved");
  await expect(admin.getByTestId("sim-validated")).toHaveText(String(before.validated + 2));
  await expect(admin.getByTestId("sim-submitted-leads")).toHaveText(String(before.submitted + 6));
  await arena.bringToFront();
  await expect(arena.getByRole("dialog", { name: /CONGRATULATIONS/ })).toBeVisible({ timeout: 10_000 });
  await expect(arena.getByRole("dialog", { name: /CONGRATULATIONS/ })).toContainText(/earned \d+ Spins?/);

  // Leaderboard columns match the shared counts for any closer shown.
  await arena.getByRole("button", { name: /Spin later/ }).click();
  await expect(arena.getByRole("dialog", { name: /CONGRATULATIONS/ })).toHaveCount(0);
  const firstRow = arena.getByTestId("closer-rows").locator("li").first();
  const sub = Number(await firstRow.locator("[data-col=submitted]").innerText());
  const val = Number(await firstRow.locator("[data-col=validated]").innerText());
  const rate = Number((await firstRow.locator("[data-col=rate]").innerText()).replace("%", ""));
  expect(rate).toBe(Math.round((val / sub) * 100));
  if (shots) await arena.screenshot({ path: `${shots}/leaderboard-tv.png` });

  // Un-validating a sale updates the board and does not re-announce when re-validated.
  await admin.bringToFront();
  const validatedRow = admin.getByTestId("sim-leads").locator("li[data-status=approved]").first();
  await validatedRow.getByLabel("Change lead status").selectOption("rejected");
  await expect(admin.getByTestId("sim-validated")).toHaveText(String(before.validated + 1));
  const rejectedRow = admin.getByTestId("sim-leads").locator("li[data-status=rejected]").first();
  await rejectedRow.getByLabel("Change lead status").selectOption("approved");
  await expect(admin.getByTestId("sim-validated")).toHaveText(String(before.validated + 2));
  await arena.bringToFront();
  await arena.waitForTimeout(2000);
  await expect(arena.getByRole("dialog", { name: /CONGRATULATIONS/ })).toHaveCount(0);
});

test("leaderboard shows the reference columns, top 10, Today", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); // all five columns show when the panel is wide
  await open(page, "/");
  const board = page.getByRole("region", { name: "Leaderboard" });
  await expect(board.getByText("Top Performer Leaderboard")).toBeVisible();
  await expect(board.getByText("Today", { exact: true })).toBeVisible();
  for (const h of ["Rank", "Closer Name", "Submitted Leads", "Validated", "Policy Closed Rate"]) {
    await expect(board.getByText(h, { exact: true })).toBeVisible();
  }
  const rows = board.getByTestId("closer-rows").locator("li");
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText(/CLS-[0-9A-F]{8}/);

  // Sorted by validated, then submitted.
  const data = await rows.evaluateAll((lis) =>
    lis.map((li) => [Number(li.querySelector("[data-col=validated]")!.textContent), Number(li.querySelector("[data-col=submitted]")!.textContent)]),
  );
  for (let i = 1; i < data.length; i++) {
    const [v0, s0] = data[i - 1];
    const [v1, s1] = data[i];
    expect(v0 > v1 || (v0 === v1 && s0 >= s1)).toBe(true);
  }

  // Readable on a phone: no horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
