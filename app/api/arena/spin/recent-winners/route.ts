import { NextResponse } from "next/server";
import { getDbPool } from "@/database/client";

export const dynamic = "force-dynamic";

/**
 * Returns the last N completed spin prize outcomes for display on the Live Arena.
 * Public (no auth): Live Arena displays are public broadcast screens.
 */
export async function GET() {
  const pool = getDbPool();
  if (!pool)
    return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 503 });

  try {
    const { rows } = await pool.query<{
      id: string;
      user_code: string;
      name: string;
      reward_title: string;
      reward_color: string;
      reward_icon: string;
      created_at: string;
    }>(
      `SELECT r.id, r.user_code, a.name, r.reward_title, r.reward_color, r.reward_icon, r.created_at
         FROM spin_results r
         JOIN agents a ON a.id = r.agent_id
        WHERE r.status = 'completed'
        ORDER BY r.created_at DESC
        LIMIT 20`,
    );
    return NextResponse.json(
      { ok: true, winners: rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[spin/recent-winners]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 503 });
  }
}
