import { NextResponse, type NextRequest } from "next/server";
import { getDbPool } from "@/database/client";

export const dynamic = "force-dynamic";

/**
 * Returns every agent with at least one pending (unconsumed) spin credit.
 * Used by the Live Arena on mount and after a spin.unlocked SSE event to restore
 * persistent spin notifications that survive a browser refresh.
 * No auth required: the Live Arena is a public broadcast display.
 */
export async function GET(_req: NextRequest) {
  const pool = getDbPool();
  if (!pool)
    return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 503 });

  try {
    const { rows } = await pool.query<{
      user_code: string;
      agent_id: string;
      name: string;
      available: number;
    }>(
      `SELECT c.user_code, c.agent_id, a.name, c.available
         FROM spin_credits c
         JOIN agents a ON a.id = c.agent_id
        WHERE c.available > 0
        ORDER BY c.updated_at DESC`,
    );
    return NextResponse.json({ ok: true, pending: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[spin/pending]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 503 });
  }
}
