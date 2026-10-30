import { test, expect, type BrowserContext } from "@playwright/test";
import { createHash } from "node:crypto";
import { liveDataConfigured } from "./helpers";

/**
 * Admin prize changes reach an open Live Arena wheel without a reload (PostgreSQL catalog +
 * rewards.catalog.updated event), and Demo Spin never writes to the database.
 * Runs against the local dev server/database only.
 */

const csrfFor = (token: string) => createHash("sha256").update(`csrf:${token}`).digest("base64url");
async function adminHeaders(context: BrowserContext, baseURL: string) {
  const cookie = (await context.cookies(baseURL)).find((c) => c.name.endsWith("sa_admin"));
  if (!cookie) throw new Error("no admin session");
  return { "x-csrf-token": csrfFor(cookie.value), Origin: new URL(baseURL).origin, "content-type": "application/json" };
}

test("Tests A/B/C/G/H: admin prize edits update the open wheel live; Demo Spin saves nothing", async ({ context, page, baseURL }) => {
  test.skip(!(await liveDataConfigured(page)), "Needs the live server with the dev database.");
  test.setTimeout(120_000);
  const headers = await adminHeaders(context, baseURL!);
  const api = context.request;
  const title = `Sync ${Date.now().toString(36)}`;
  // Real spin results + ledger rows (both must stay unchanged by a demo spin).
  const historyCount = async () => {
    const spins = (await (await api.get("/api/admin/spins/history?type=spins&limit=500", { headers })).json()).spins;
    const tx = (await (await api.get("/api/admin/spins/history?limit=500", { headers })).json()).transactions;
    if (!Array.isArray(spins) || !Array.isArray(tx)) throw new Error("history unavailable");
    return `${spins.length}/${tx.length}`;
  };

  // Open the Spin & Win wheel via Demo Spin (visual only).
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("tab", { name: "Spin & Win" }).click();
  const spinsBefore = await historyCount();
  await page.getByTestId("demo-spin").click();
  await page.getByRole("dialog", { name: /CONGRATULATIONS/ }).getByRole("button", { name: "SPIN NOW" }).click();
  const wheel = page.getByTestId("spin-wheel");
  await expect(wheel).toBeVisible({ timeout: 15_000 });

  // B: new prize appears on the open wheel without a reload.
  const created = await api.post("/api/admin/catalog", { headers, data: { title, description: "", icon: "star", color: "#123456", active: true, quantity: null, weight: 1, displayOrder: 999 } });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  await expect(wheel).toHaveAttribute("data-segments", new RegExp(`${title}\\|#123456`), { timeout: 10_000 });

  // A: rename + recolour.
  const renamed = `${title} v2`;
  const patched = await api.patch(`/api/admin/catalog/${id}`, { headers, data: { title: renamed, description: "", icon: "star", color: "#654321", active: true, quantity: null, weight: 1, displayOrder: 999 } });
  expect(patched.ok()).toBe(true);
  await expect(wheel).toHaveAttribute("data-segments", new RegExp(`${renamed}\\|#654321`), { timeout: 10_000 });

  // G: the demo spin itself records nothing.
  await page.getByTestId("spin-button").click();
  await expect(page.locator("[data-reveal-state]")).toBeVisible({ timeout: 30_000 });
  expect(await historyCount()).toBe(spinsBefore);

  // Persisted: a fresh load of the public catalog has the edit.
  const cat = await (await api.get("/api/arena/catalog")).json();
  expect(cat.prizes.some((p: { title: string; color: string }) => p.title === renamed && p.color === "#654321")).toBe(true);

  // C: removing it takes it off the wheel (a new page, i.e. after reload, too).
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("tab", { name: "Spin & Win" }).click();
  await page.getByTestId("demo-spin").click();
  await page.getByRole("dialog", { name: /CONGRATULATIONS/ }).getByRole("button", { name: "SPIN NOW" }).click();
  await expect(page.getByTestId("spin-wheel")).toHaveAttribute("data-segments", new RegExp(renamed), { timeout: 15_000 });
  expect((await api.delete(`/api/admin/catalog/${id}`, { headers })).ok()).toBe(true);
  await expect(page.getByTestId("spin-wheel")).not.toHaveAttribute("data-segments", new RegExp(renamed), { timeout: 10_000 });
});
