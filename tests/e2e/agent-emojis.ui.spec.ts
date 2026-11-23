import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { display, TWO } from "./teams-ui-helpers";
import { sse } from "./cub-helpers";

for (const mode of ["daily", "weekly", "monthly", "teams"] as const) {
    test(mode + " displays original emoji through the existing real sale renderer with redesigned layout", async ({ page }) => {
        const d = await display(page, { slugs: TWO });
        await page.route("**/api/arena/agent-emojis**", async (route) => {
            if (route.request().url().includes("?agent="))
                await route.fulfill({ json: { url: "/api/arena/agent-emojis/test-original" } });
            else
                await route.fulfill({ contentType: "image/png", body: readFileSync("assets/Emojis of Agents/Mansoor Arshad-Photoroom.png") });
        });
        await page.goto("/?screen=" + mode);
        await expect(page.locator('[data-arena-mode="' + mode + '"]')).toBeVisible({ timeout: 120000 });
        await page.waitForTimeout(1200);
        const now = Date.now(), at = new Date(now - 1000).toISOString();
        d.stream(sse("sale.validated", { caseId: "emoji-" + mode + now, userCode: "UI-SIGMA-0", closerName: "Mansoor Arshad", validatedAt: at, source: "sse", firstSeenAt: at, storedAt: at, broadcastAt: at, team: { id: "team_sigma", slug: "sigma", name: "Team Sigma", active: true, logoUrl: "/teams/team-sigma.webp", color: "#8B5CF6", accentSecondary: null, businessDate: at.slice(0, 10) } }), 2);
        const img = page.getByAltText("Mansoor Arshad emoji");
        await expect(img).toBeVisible({ timeout: 15000 });
        await expect(img).toHaveCount(1);
        expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1254);
        expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe("contain");

        if (mode !== "teams") {
            const popup = page.getByTestId("sale-celebration-popup");
            await expect(popup).toBeVisible();
            await expect(page.getByTestId("sale-celebration-heading")).toHaveText("NEW SALE APPROVED!");
            await expect(page.getByTestId("sale-celebration-agent")).toHaveText("Mansoor Arshad");
            await expect(page.getByTestId("sale-celebration-support")).toHaveText("Just made a sale!");

            const layout = await page.evaluate(() => {
                const p = document.querySelector('[data-testid="sale-celebration-popup"]')!.getBoundingClientRect();
                const e = document.querySelector('img[alt="Mansoor Arshad emoji"]')!.getBoundingClientRect();
                return {
                    centerXDelta: Math.abs((p.left + p.right) / 2 - window.innerWidth / 2),
                    centerYDelta: Math.abs((p.top + p.bottom) / 2 - window.innerHeight / 2),
                    emojiHeight: e.height,
                };
            });
            expect(layout.centerXDelta).toBeLessThan(20);
            expect(layout.centerYDelta).toBeLessThan(40);
            expect(layout.emojiHeight).toBeGreaterThanOrEqual(240);
            expect(layout.emojiHeight).toBeLessThanOrEqual(320);
        } else {
            await page.waitForTimeout(1600);
            const metrics = await page.evaluate(() => {
                const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect();
                const overlap = (a: DOMRect, b: DOMRect) =>
                    !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
                const emoji = rect('img[alt="Mansoor Arshad emoji"]');
                const plate = rect('[data-testid="team-emblem"] .tc-emblem-plate');
                const crest = rect('[data-testid="team-celebration"] [data-testid="team-celebration-crest"]');
                const headline = rect('[data-testid="team-celebration-headline"]');
                const agent = rect('[data-testid="team-celebration-agent"]');
                return {
                    emojiHeight: emoji.height,
                    overlapsPlate: overlap(emoji, plate),
                    overlapsCrest: overlap(emoji, crest),
                    overlapsHeadline: overlap(emoji, headline),
                    overlapsAgent: overlap(emoji, agent),
                };
            });
            // ~50% larger than the old 259px (target 40-60% increase => 360-415px on 1080p)
            expect(metrics.emojiHeight).toBeGreaterThanOrEqual(360);
            expect(metrics.emojiHeight).toBeLessThanOrEqual(415);
            expect(metrics.overlapsPlate).toBe(false);
            expect(metrics.overlapsCrest).toBe(false);
            expect(metrics.overlapsHeadline).toBe(false);
            expect(metrics.overlapsAgent).toBe(false);
        }

        await page.screenshot({ path: "test-results/emoji-" + mode + ".png" });
    });
}

test("missing emoji displays clean fallback in centered bonus-style sale popup", async ({ page }) => {
    const d = await display(page, { slugs: TWO });
    await page.route("**/api/arena/agent-emojis**", async (route) => {
        await route.fulfill({ json: { url: null } });
    });
    await page.goto("/?screen=daily");
    await expect(page.locator('[data-arena-mode="daily"]')).toBeVisible({ timeout: 120000 });
    await page.waitForTimeout(1000);
    const now = Date.now(), at = new Date(now - 1000).toISOString();
    d.stream(sse("sale.validated", { caseId: "emoji-fallback-" + now, userCode: "UI-NO-EMOJI", closerName: "Unassigned Agent", validatedAt: at, source: "sse", firstSeenAt: at, storedAt: at, broadcastAt: at }), 1);
    await expect(page.getByTestId("sale-celebration-popup")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("sale-celebration-fallback")).toBeVisible();
    await expect(page.getByTestId("sale-celebration-agent")).toHaveText("Unassigned Agent");
});
