import React from "react";
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { validateEmoji, normalizeEmojiName } from "@/backend/emojis/media";
import { AgentEmoji } from "@/frontend/components/celebrations/AgentEmoji";
import { CelebrationOverlay } from "@/frontend/components/celebrations/CelebrationOverlay";
import { useCelebrationStore } from "@/frontend/stores/celebration-store";
import { POST } from "@/app/api/admin/agent-emojis/route";
import { NextRequest } from "next/server";
vi.mock("@/backend/auth/guard", () => ({ requireAdmin: async () => ({ ok: false, response: new Response(null, { status: 401 }) }), jsonError: () => new Response(null, { status: 400 }) }));
describe("agent emoji originals and upload boundary", () => {
    it.each(readdirSync("assets/Emojis of Agents"))("decodes and preserves %s", async (filename) => {
        const bytes = readFileSync("assets/Emojis of Agents/" + filename);
        const before = Buffer.from(bytes);
        expect((await validateEmoji(bytes, filename, "image/png")).mime).toBe("image/png");
        expect(bytes.equals(before)).toBe(true);
    });
    it("normalizes only exact name matching", () => { expect(normalizeEmojiName(" Ali  Sikandar-Photoroom.png")).toBe("ali sikandar"); expect(normalizeEmojiName("Adeel Afzal")).not.toBe(normalizeEmojiName("Muhammad Adeel Afzal")); });
    it("accepts decoded JPEG and WebP", async () => { for (const format of ["jpeg", "webp"] as const) {
        const b = await sharp({ create: { width: 20, height: 20, channels: 4, background: "red" } }).toFormat(format).toBuffer();
        expect((await validateEmoji(b, "test." + format, "image/" + format)).width).toBe(20);
    } });
    it("rejects bad contents, spoofed metadata, empty, oversized and SVG", async () => {
        for (const b of [Buffer.alloc(0), Buffer.from("<svg/>"), Buffer.alloc(10000001)])
            await expect(validateEmoji(b, "x.png", "image/png")).rejects.toThrow();
        const b = readFileSync("assets/Emojis of Agents/Mansoor Arshad-Photoroom.png");
        await expect(validateEmoji(b, "x.jpg", "image/jpeg")).rejects.toThrow();
    });
    it("rejects anonymous mutation", async () => { expect((await POST(new NextRequest("http://arena.test/api/admin/agent-emojis", { method: "POST" }))).status).toBe(401); });
    it("missing emoji renders nothing, retaining the existing parent fallback", () => { expect(renderToStaticMarkup(<AgentEmoji agentId={null} name="Agent"/>)).toBe(""); });
    it("local preview renders the real renderer without changing the production queue", () => {
        const before = useCelebrationStore.getState();
        const html = renderToStaticMarkup(<CelebrationOverlay previewEvent={{ id: "preview", tier: "sale", headline: "NEW SALE APPROVED!", subline: "Preview", agentId: "M", agentName: "Mansoor Arshad", teamName: null, teamColor: null, value: null, createdAt: "", preview: true }}/>);
        expect(html).toContain("Mansoor Arshad");
        expect(useCelebrationStore.getState()).toBe(before);
    });
});
