import { test, expect } from "@playwright/test";

/** Owner panel: Award History shows real rows and the missing-award scan is read-only (writes nothing). */
test("Owner can scan a business date range for missing awards without creating anything", async ({ page }) => {
  const before = await (await page.request.get("/api/admin/awards?limit=500")).json();
  await page.goto("/admin/programs");
  await page.getByRole("tab", { name: "Award History" }).click();
  await expect(page.getByTestId("award-history")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("open-recovery").click();
  await expect(page.getByTestId("recovery-panel")).toBeVisible();
  await page.getByTestId("scan-run").click();
  await expect(page.getByTestId("scan-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("scan-result")).toContainText(/validated sale\(s\) by \d+ agent\(s\)/);
  await expect(page.getByTestId("recovery-approve")).toHaveCount((await page.getByTestId("scan-item").count()) > 0 ? 1 : 0);
  const after = await (await page.request.get("/api/admin/awards?limit=500")).json();
  expect(after.totals.count).toBe(before.totals.count); // scanning never writes
});
