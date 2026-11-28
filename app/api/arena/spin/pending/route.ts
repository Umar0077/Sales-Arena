import { NextResponse, type NextRequest } from "next/server";
import { getDbPool } from "@/database/client";
import { recoverStaleSpins } from "@/backend/spins/execute";

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
    await recoverStaleSpins(pool, 90).catch(() => []);
    const [{ rows: pending }, { rows: inProgress }] = await Promise.all([
      pool.query<{
        user_code: string;
        agent_id: string;
        name: string;
        available: number;
      }>(
        `SELECT c.user_code,
                COALESCE(a.id, c.agent_id, 'agt_' || c.user_code) AS agent_id,
                COALESCE(a.name, c.user_code) AS name,
                c.available::int AS available
           FROM spin_credits c
           LEFT JOIN agents a ON a.user_code = c.user_code
          WHERE c.available > 0
          ORDER BY c.updated_at DESC`,
      ),
      pool.query<{
        spin_id: string;
        user_code: string;
        name: string;
        created_at: string;
      }>(
        `SELECT r.id AS spin_id, r.user_code, COALESCE(a.name, r.user_code) AS name, r.created_at
           FROM spin_results r
           LEFT JOIN agents a ON a.user_code = r.user_code
          WHERE r.status = 'in-progress'
            AND r.created_at > NOW() - INTERVAL '10 minutes'
          ORDER BY r.created_at DESC`,
      ),
    ]);
    return NextResponse.json(
      { ok: true, pending, inProgress, serverTime: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[spin/pending]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 503 });
  }
}
