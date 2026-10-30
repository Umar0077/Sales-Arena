import { NextResponse, type NextRequest } from "next/server";
import { getDbPool } from "@/lib/server/db/client";

export const dynamic = "force-dynamic";

/** Authoritative PostgreSQL spin balance totals for the Live Arena KPI display. */
export async function GET(_req: NextRequest) {
  const pool = getDbPool();
  if (!pool) {
    return NextResponse.json({ ok: false, mode: "no-database" }, { status: 503 });
  }
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(quantity) FILTER (WHERE kind IN ('automatic', 'manual')), 0)::int AS unlocked,
              (SELECT COALESCE(SUM(available), 0)::int FROM spin_credits) AS available
         FROM spin_credit_transactions`
    );
    const unlocked = rows[0]?.unlocked ?? 0;
    const available = rows[0]?.available ?? 0;
    return NextResponse.json(
      { ok: true, unlocked, available },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (_err) {
    return NextResponse.json({ ok: false, error: "Database query failed" }, { status: 500 });
  }
}
