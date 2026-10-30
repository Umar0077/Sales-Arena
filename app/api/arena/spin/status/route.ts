import { NextResponse, type NextRequest } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { resolveSpinActor } from "@/lib/server/auth/arena-device";
import { loadWheelSegments } from "@/lib/server/spins/execute";

export const dynamic = "force-dynamic";

/**
 * Spin readiness for the Live Arena: whether this display may spin, the agent's
 * server-side balance, and the prize list the server will choose from.
 */
export async function GET(req: NextRequest) {
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, mode: "no-database" }, { status: 503 });
  try {
    const actor = await resolveSpinActor(req);
    if (!actor) return NextResponse.json({ ok: true, authorized: false }, { headers: { "Cache-Control": "no-store" } });
    const userCode = (req.nextUrl.searchParams.get("userCode") ?? "").trim().toUpperCase();
    const segments = await loadWheelSegments(pool);
    let available = 0;
    if (/^[A-Z0-9:_.-]{1,64}$/.test(userCode)) {
      const { rows } = await pool.query(`SELECT available FROM spin_credits WHERE user_code = $1`, [userCode]);
      available = rows[0]?.available ?? 0;
    }
    return NextResponse.json({ ok: true, authorized: true, available, segments }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 503 });
  }
}
