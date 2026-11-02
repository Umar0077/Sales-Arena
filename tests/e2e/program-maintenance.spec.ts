import { test, expect, type BrowserContext } from "@playwright/test";
import { createHash } from "node:crypto";

/** Owner Delete + Extend in the Admin UI (dev database; programs created here are removed again; no awards). */
const csrfFor = (t: string) => createHash("sha256").update(`csrf:${t}`).digest("base64url");
async function api(ctx: BrowserContext, baseURL: string) {
  const cookie = (await ctx.cookies(baseURL)).find((c) => c.name.endsWith("sa_admin"))!;
  const headers = { "x-csrf-token": csrfFor(cookie.value), Origin: new URL(baseURL).origin, "content-type": "application/json" };
  return async (method: string, url: string, data?: unknown) => {
    const r = await ctx.request.fetch(url, { method, headers, data });
    return { status: r.status(), body: await r.json() };
  };
}
const lastDay = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

test("Owner deletes an unused program (other admin tab updates live) and extends a program to a future month", async ({ browser, context, baseURL, page }) => {
  test.setTimeout(180_000);
  const call = await api(context, baseURL!);
  const P = `E2E-PM-${Date.now() % 100000}`;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const made: string[] = [];
  try {
    // Paused programs (never award) with unique thresholds, so no duplicate / award side effects.
    const del = (await call("POST", "/api/admin/programs", { kind: "daily", name: `${P} delete me`, rewardType: "cash", currency: "PKR", amount: 123, salesRequired: 97, enabled: false })).body.program;
    const ext = (await call("POST", "/api/admin/programs", { kind: "daily", name: `${P} extend me`, rewardType: "cash", currency: "PKR", amount: 456, salesRequired: 98, enabled: false, startDate: `${thisMonth}-01`, endDate: lastDay(thisMonth) })).body.program;
    made.push(del.id, ext.id);
    // Activate the extend target through the real flow (sets its activation time once).
    await call("PATCH", `/api/admin/programs/${ext.id}`, { enabled: true });
    const activeSince = (await call("GET", "/api/admin/programs?kind=daily")).body.programs.find((p: { id: string }) => p.id === ext.id).activeSince;

    const other = await browser.newContext({ storageState: "tests/e2e/.auth/admin.json" });
    const otherPage = await other.newPage();
    for (const pg of [page, otherPage]) {
      await pg.goto("/admin/programs");
      await pg.getByRole("tab", { name: "Daily Rewards" }).click();
      await expect(pg.locator(`[data-testid=program-row][data-program="${P} delete me"]`)).toBeVisible({ timeout: 60_000 });
    }

    // Delete: the dialog shows the real details and zero linked awards.
    const row = page.locator(`[data-testid=program-row][data-program="${P} delete me"]`);
    await row.getByTestId("program-delete").click();
    const dlg = page.getByTestId("delete-dialog");
    await expect(dlg).toContainText(`${P} delete me`);
    await expect(dlg).toContainText("97 validated sales");
    await expect(dlg).toContainText("PKR 123");
    await expect(dlg.getByTestId("delete-award-count")).toHaveText("0");
    await expect(dlg.getByTestId("delete-permanent")).toBeDisabled();
    await dlg.getByTestId("delete-confirm").check();
    await dlg.getByTestId("delete-permanent").click();
    await expect(row).toHaveCount(0);
    await expect(page.getByText(/permanently deleted/)).toBeVisible();
    // The other admin tab follows over SSE, no reload.
    await expect(otherPage.locator(`[data-testid=program-row][data-program="${P} delete me"]`)).toHaveCount(0, { timeout: 10_000 });
    made.shift();

    // Extend to next month through the month picker.
    await page.getByTestId("extend-programs").click();
    const ed = page.getByTestId("extend-dialog");
    const month = await ed.getByTestId("extend-month").inputValue();
    expect(month > thisMonth).toBe(true); // earliest choice is a future month
    await ed.getByTestId("extend-preview").click();
    const xrow = ed.locator(`[data-testid=extend-row][data-program="${P} extend me"]`);
    await expect(xrow).toHaveAttribute("data-status", "will_extend");
    await expect(xrow).toContainText(lastDay(month));
    await ed.getByTestId("extend-confirm").check();
    await ed.getByTestId("extend-apply").click();
    await expect(page.getByText(new RegExp(`ends ${lastDay(month)}`))).toBeVisible();
    const after = (await call("GET", "/api/admin/programs?kind=daily")).body.programs.find((p: { id: string }) => p.id === ext.id);
    expect(after).toMatchObject({ endDate: lastDay(month), startDate: `${thisMonth}-01`, activeSince, salesRequired: 98, amount: 456, enabled: true });
    await other.close();
  } finally {
    for (const id of made) {
      const r = await call("POST", `/api/admin/programs/${id}/permanent`, { confirm: true });
      if (r.status !== 200) await call("DELETE", `/api/admin/programs/${id}`);
    }
  }
});
