import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { display, TWO } from "./teams-ui-helpers";
import { sse } from "./cub-helpers";
for (const mode of ["daily", "weekly", "monthly", "teams"]) {
    test(mode + " displays original emoji through the existing real sale renderer", async ({ page }) => {
        const d = await display(page, { slugs: TWO });
        await page.route("**/api/arena/agent-emojis**", async (route) => { if (route.request().url().includes("?agent="))
            await route.fulfill({ json: { url: "/api/arena/agent-emojis/test-original" } });
        else
            await route.fulfill({ contentType: "image/png", body: readFileSync("assets/Emojis of Agents/Mansoor Arshad-Photoroom.png") }); });
        await page.goto("/?screen=" + mode);
        await expect(page.locator('[data-arena-mode="' + mode + '"]')).toBeVisible({ timeout: 120000 });
        await page.waitForTimeout(1200);
        const now = Date.now(), at = new Date(now - 1000).toISOString();
        d.stream(sse("sale.validated", { caseId: "emoji-" + mode + now, userCode: "UI-SIGMA-0", closerName: "Mansoor Arshad", validatedAt: at, source: "sse", firstSeenAt: at, storedAt: at, broadcastAt: at, team: { id: "team_sigma", slug: "sigma", name: "Team Sigma", active: true, logoUrl: "/teams/team-sigma.webp", color: "#8B5CF6", accentSecondary: null, businessDate: at.slice(0, 10) } }), 2);
        const img = page.getByAltText("Mansoor Arshad emoji");
        await expect(img).toBeVisible({ timeout: 15000 });
        await expect(img).toHaveCount(1);
        expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1254);
        await page.screenshot({ path: "test-results/emoji-" + mode + ".png" });
    });
}
