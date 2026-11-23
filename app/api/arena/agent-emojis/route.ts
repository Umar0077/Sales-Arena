import { NextRequest, NextResponse } from "next/server";
import { getDbPool } from "@/database/client";
export async function GET(req: NextRequest) {
    const db = getDbPool();
    if (!db)
        return NextResponse.json({ url: null });
    try {
        const code = req.nextUrl.searchParams.get("agent") ?? "";
        const r = await db.query("SELECT e.asset_id FROM agent_emoji_assignments e JOIN agents a ON a.id=e.agent_id WHERE (a.id=$1 OR a.user_code=$1) AND NOT EXISTS (SELECT 1 FROM admin_settings WHERE key='agent_emojis.enabled' AND value='false'::jsonb)", [code]);
        return NextResponse.json({ url: r.rows.length === 1 ? "/api/arena/agent-emojis/" + r.rows[0].asset_id : null }, { headers: { "Cache-Control": "no-store" } });
    }
    catch {
        return NextResponse.json({ url: null }, { headers: { "Cache-Control": "no-store" } });
    }
}
