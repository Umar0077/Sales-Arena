import { NextRequest } from "next/server";
import { getDbPool } from "@/database/client";
export async function GET(_req: NextRequest, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { id } = await params;
    if (!/^[a-f0-9]{64}$/.test(id))
        return new Response(null, { status: 404 });
    const db = getDbPool();
    if (!db)
        return new Response(null, { status: 503 });
    const r = await db.query("SELECT mime,content FROM agent_emoji_assets WHERE id=$1", [id]);
    if (!r.rows[0])
        return new Response(null, { status: 404 });
    return new Response(new Uint8Array(r.rows[0].content), { headers: { "Content-Type": r.rows[0].mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
