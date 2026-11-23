import { beforeAll, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pool, resetDatabase, createAgent } from "./helpers";
import { saveEmoji } from "@/backend/emojis/media";
import { GET } from "@/app/api/arena/agent-emojis/route";
import { NextRequest } from "next/server";
describe("persistent original emoji assignments", () => {
    beforeAll(async () => { await resetDatabase(); await createAgent("EMOJI", "Mansoor Arshad"); });
    it("persists original bytes and resolves only stable identity; failed replacement retains assignment", async () => {
        const db = pool();
        const before = (await db.query("SELECT * FROM agents WHERE user_code='EMOJI'")).rows[0];
        const bytes = readFileSync("assets/Emojis of Agents/Mansoor Arshad-Photoroom.png");
        const asset = await saveEmoji(db, bytes, "Mansoor Arshad-Photoroom.png", "image/png");
        await db.query("INSERT INTO agent_emoji_assignments (agent_id,asset_id) VALUES ($1,$2)", [before.id, asset.id]);
        const resolve = async (id: string) => (await GET(new NextRequest("http://arena.test/api/arena/agent-emojis?agent=" + encodeURIComponent(id)))).json();
        expect((await resolve("EMOJI")).url).toContain(asset.id);
        expect((await resolve(before.id)).url).toContain(asset.id);
        expect((await resolve("Mansoor Arshad")).url).toBeNull();
        await expect(saveEmoji(db, Buffer.from("invalid"), "x.png", "image/png")).rejects.toThrow();
        expect((await resolve("EMOJI")).url).toContain(asset.id);
        expect((await db.query("SELECT content FROM agent_emoji_assets WHERE id=$1", [asset.id])).rows[0].content.equals(bytes)).toBe(true);
        expect((await db.query("SELECT * FROM agents WHERE user_code='EMOJI'")).rows[0]).toEqual(before);
        expect((await db.query("SELECT COUNT(*)::int AS n FROM validated_sales")).rows[0].n).toBe(0);
    });
});
