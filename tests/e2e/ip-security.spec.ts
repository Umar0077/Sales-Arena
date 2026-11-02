import { test, expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { createHash } from "node:crypto";

/**
 * Test 14: multiple browsers / networks. The dev server has no nginx, so each browser context
 * presents its client IP as X-Real-IP (exactly what nginx sends). Documentation IP ranges only.
 * The restriction is always switched off again at the end (finally), so other tests are unaffected.
 */
const OFFICE = "192.0.2.10";
const FLOOR_IP = "198.51.100.20";
const OUTSIDE = "203.0.113.99";

const csrfFor = (t: string) => createHash("sha256").update(`csrf:${t}`).digest("base64url");
async function ownerApi(ctx: BrowserContext, baseURL: string) {
  const cookie = (await ctx.cookies(baseURL)).find((c) => c.name.endsWith("sa_admin"))!;
  const headers = { "x-csrf-token": csrfFor(cookie.value), Origin: new URL(baseURL).origin, "content-type": "application/json", "x-real-ip": OFFICE };
  return { req: ctx.request as APIRequestContext, headers };
}

test("Owner whitelists networks and turns restriction on; allowed and blocked networks see the right thing", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const admin = await browser.newContext({ storageState: "tests/e2e/.auth/admin.json", extraHTTPHeaders: { "x-real-ip": OFFICE } });
  const page = await admin.newPage();
  const { req, headers } = await ownerApi(admin, baseURL!);
  const cleanup = async () => {
    await req.put("/api/admin/ip-security/settings", { headers, data: { enabled: false } });
    const ov = await (await req.get("/api/admin/ip-security", { headers })).json();
    for (const r of ov.rules ?? []) if (r.status !== "archived" && [OFFICE, "198.51.100.0/24"].includes(r.network)) await req.delete(`/api/admin/ip-security/rules/${r.id}`, { headers });
  };
  await cleanup(); // start from a known state
  try {
    await page.goto("/admin/ip-security");
    await expect(page.getByRole("heading", { name: "IP Perimeter Security" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Restrict FE Sales Arena access to authorized network IP addresses.")).toBeVisible();
    await expect(page.getByTestId("protection-status")).toHaveText("PROTECTION OFF");
    await expect(page.getByTestId("current-ip")).toHaveText(OFFICE);

    // Enabling is impossible before a management network covers this admin.
    await page.getByTestId("master-switch").click();
    await expect(page.getByTestId("enable-save")).toBeDisabled();
    await page.getByTestId("enable-modal").getByRole("button", { name: "Close" }).click();

    // Whitelist my current IP (server-observed).
    await page.getByTestId("whitelist-me").click();
    await page.getByTestId("my-ip-label").fill("Head Office");
    await page.getByTestId("my-ip-confirm").check();
    await page.getByTestId("my-ip-save").click();
    await expect(page.locator(`[data-testid=rule-row][data-network="${OFFICE}"]`)).toBeVisible();

    // Add New Rule: frontend validation, then a CIDR range.
    await page.getByTestId("add-rule").click();
    await page.getByTestId("rule-network").fill("198.51.100.5/24");
    await expect(page.getByTestId("rule-network-error")).toContainText("198.51.100.0/24");
    await page.getByTestId("rule-network").fill("198.51.100.0/24");
    await page.getByTestId("rule-label").fill("FE Floor");
    await page.getByTestId("rule-save").click();
    const floorRow = page.locator('[data-testid=rule-row][data-network="198.51.100.0/24"]');
    await expect(floorRow.getByTestId("rule-status")).toHaveText("active");
    await page.getByTestId("rule-search").fill("floor");
    await expect(page.getByTestId("rule-row")).toHaveCount(1);
    await page.getByTestId("rule-search").fill("");

    // Turn the restriction on (explicit confirmation).
    await page.getByTestId("master-switch").click();
    await page.getByTestId("enable-confirm").check();
    await page.getByTestId("enable-save").click();
    await expect(page.getByTestId("protection-status")).toHaveText("PROTECTION ON");

    // Different networks / browsers.
    const floor = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": FLOOR_IP } });
    const fp = await floor.newPage();
    await fp.goto("/");
    await expect(fp.locator("[data-arena-mode]")).toBeVisible({ timeout: 60_000 });

    const outside = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": OUTSIDE, "x-forwarded-for": OFFICE } });
    const op = await outside.newPage();
    const res = await op.goto("/");
    expect(res?.status()).toBe(403);
    await expect(op.getByRole("heading", { name: "ACCESS RESTRICTED" })).toBeVisible();
    await expect(op.getByText("This network is not authorized to access FE Sales Arena. Please contact your administrator.")).toBeVisible();
    await expect(op.locator("[data-arena-mode]")).toHaveCount(0);
    expect((await op.request.get("/api/arena/summary")).status()).toBe(403);
    expect((await op.request.get("/api/arena/stream")).status()).toBe(403);

    const noIp = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    expect((await (await noIp.newPage()).goto("/"))?.status()).toBe(403);

    // Deactivate the floor rule from the UI: that network is blocked on the next request, no restart.
    await floorRow.getByTestId("rule-toggle").click();
    await expect(floorRow.getByTestId("rule-status")).toHaveText("inactive");
    expect((await fp.goto("/"))?.status()).toBe(403);

    // Lockout protection in the UI: deleting the only management rule is refused with an explanation.
    page.once("dialog", (d) => void d.accept());
    await page.locator(`[data-testid=rule-row][data-network="${OFFICE}"]`).getByTestId("rule-delete").click();
    await expect(page.getByText(/Refused: At least one active Admin-access rule/)).toBeVisible();

    for (const c of [floor, outside, noIp]) await c.close();
  } finally {
    await cleanup();
    await admin.close();
  }
});
