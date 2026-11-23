import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, jsonError } from "@/backend/auth/guard";
import { saveEmoji, normalizeEmojiName, matchAgentForEmoji } from "@/backend/emojis/media";
import { calendarFrom, readArenaConfig } from "@/backend/settings/arena-config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
export async function GET(req: NextRequest) {
    const a = await requireAdmin(req);
    if (!a.ok)
        return a.response;
    const timezone = calendarFrom((await readArenaConfig(a.pool)).values).timezone;
    const agents = await a.pool.query(`SELECT a.id, a.user_code, a.name, e.asset_id,
 (SELECT jsonb_build_object('id',t.id,'slug',t.slug,'name',t.name,'active',t.active,'logoUrl',t.logo_url,'color',t.color,'accentSecondary',t.accent_secondary,'businessDate',(NOW() AT TIME ZONE $1)::date)
 FROM team_memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_code=a.user_code AND m.effective_from <= (NOW() AT TIME ZONE $1)::date AND (m.effective_to IS NULL OR m.effective_to > (NOW() AT TIME ZONE $1)::date) ORDER BY m.effective_from DESC LIMIT 1) AS team
 FROM agents a LEFT JOIN agent_emoji_assignments e ON e.agent_id=a.id ORDER BY a.name`, [timezone]);
    const assets = await a.pool.query("SELECT id, filename, mime, width, height FROM agent_emoji_assets ORDER BY filename");
    const setting = await a.pool.query("SELECT value FROM admin_settings WHERE key='agent_emojis.enabled'");
    return NextResponse.json({ ok: true, agents: agents.rows, assets: assets.rows, enabled: setting.rows[0]?.value !== false });
}
export async function POST(req: NextRequest) {
    const a = await requireAdmin(req);
    if (!a.ok)
        return a.response;
    try {
        if (Number(req.headers.get("content-length")) > 6000000)
            return jsonError(413, "Upload too large.");
        const reader = req.body?.getReader();
        if (!reader)
            return jsonError(400, "Missing request body.");
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
            const part = await reader.read();
            if (part.done)
                break;
            size += part.value.length;
            if (size > 6000000) {
                await reader.cancel();
                return jsonError(413, "Upload too large.");
            }
            chunks.push(part.value);
        }
        const b = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (b.action === "enabled") {
            if (typeof b.enabled !== "boolean")
                return jsonError(400, "Choose enabled or disabled.");
            await a.pool.query("INSERT INTO admin_settings (key,value) VALUES ('agent_emojis.enabled',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(b.enabled)]);
            return NextResponse.json({ ok: true });
        }
        if (b.action === "import") {
            const dir = path.join(process.cwd(), "assets", "Emojis of Agents");
            const agents = (await a.pool.query("SELECT id, name, user_code FROM agents")).rows;
            const importedImages: Array<{ filename: string; id: string; width: number; height: number }> = [];
            const exactMatched: Array<{ filename: string; agentId: string; agentName: string; userCode?: string; status: string; reason?: string }> = [];
            const unmatchedImages: Array<{ filename: string; reason: string }> = [];
            const ambiguousMatches: Array<{ filename: string; candidates: string[]; reason: string }> = [];
            const assignedAgentIds = new Set<string>();

            const existingAssignments = (await a.pool.query("SELECT agent_id FROM agent_emoji_assignments")).rows;
            existingAssignments.forEach((r) => assignedAgentIds.add(r.agent_id));

            const files = (await readdir(dir)).filter((n) => n.endsWith(".png")).slice(0, 100);
            for (const filename of files) {
                const bytes = await readFile(path.join(dir, filename));
                const asset = await saveEmoji(a.pool, bytes, filename, "image/png");
                importedImages.push({ filename, id: asset.id, width: asset.width, height: asset.height });

                const match = matchAgentForEmoji(filename, agents);
                if (match.status === "exact" && match.agent) {
                    const r = await a.pool.query(
                        "INSERT INTO agent_emoji_assignments (agent_id, asset_id) VALUES ($1, $2) ON CONFLICT (agent_id) DO NOTHING RETURNING agent_id",
                        [match.agent.id, asset.id]
                    );
                    const status = r.rowCount ? "assigned" : "existing assignment preserved";
                    assignedAgentIds.add(match.agent.id);
                    exactMatched.push({
                        filename,
                        agentId: match.agent.id,
                        agentName: match.agent.name,
                        userCode: match.agent.user_code,
                        status,
                        reason: match.reason,
                    });
                } else if (match.status === "ambiguous") {
                    ambiguousMatches.push({
                        filename,
                        candidates: match.candidates.map((x) => `${x.name} (${x.id})`),
                        reason: match.reason ?? "Ambiguous match",
                    });
                } else {
                    unmatchedImages.push({
                        filename,
                        reason: match.reason ?? "No matching agent found in database",
                    });
                }
            }

            const agentsWithoutEmojis = agents
                .filter((ag) => !assignedAgentIds.has(ag.id))
                .map((ag) => ({ id: ag.id, name: ag.name, userCode: ag.user_code }));

            const summary = {
                totalAssetsFound: files.length,
                imagesImported: importedImages.length,
                assignmentsCompleted: exactMatched.filter((m) => m.status === "assigned").length,
                existingPreserved: exactMatched.filter((m) => m.status === "existing assignment preserved").length,
                unmatchedImages: unmatchedImages.length,
                ambiguousMatches: ambiguousMatches.length,
                agentsWithoutEmojis: agentsWithoutEmojis.length,
            };

            return NextResponse.json({
                ok: true,
                summary,
                report: {
                    importedImages,
                    exactMatched,
                    unmatchedImages,
                    ambiguousMatches,
                    agentsWithoutEmojis,
                },
            });
        }
        if (typeof b.agentId !== "string" || !(await a.pool.query("SELECT id FROM agents WHERE id=$1", [b.agentId])).rowCount)
            return jsonError(404, "Agent not found.");
        if (b.action === "remove") {
            await a.pool.query("DELETE FROM agent_emoji_assignments WHERE agent_id=$1", [b.agentId]);
        }
        else {
            let assetId = b.assetId;
            if (b.action === "upload") {
                if (typeof b.base64 !== "string" || b.base64.length > 5400000 || typeof b.filename !== "string" || typeof b.mime !== "string")
                    return jsonError(400, "Invalid upload.");
                assetId = (await saveEmoji(a.pool, Buffer.from(b.base64, "base64"), b.filename, b.mime)).id;
            }
            else if (b.action !== "assign")
                return jsonError(400, "Unknown action.");
            if (typeof assetId !== "string" || !(await a.pool.query("SELECT id FROM agent_emoji_assets WHERE id=$1", [assetId])).rowCount)
                return jsonError(404, "Image not found.");
            await a.pool.query("INSERT INTO agent_emoji_assignments (agent_id,asset_id) VALUES ($1,$2) ON CONFLICT (agent_id) DO UPDATE SET asset_id=EXCLUDED.asset_id,updated_at=NOW()", [b.agentId, assetId]);
        }
        return NextResponse.json({ ok: true });
    }
    catch {
        return jsonError(400, "Emoji operation failed. Check the image, database migration and asset directory. Existing assignments are preserved on upload failure.");
    }
}
