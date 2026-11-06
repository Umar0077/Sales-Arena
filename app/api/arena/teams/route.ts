import { NextResponse, type NextRequest } from "next/server";
import { getDbPool } from "@/database/client";
import { cachedStandings, PERIODS } from "@/backend/teams/standings";

export const dynamic = "force-dynamic";

/**
 * Teams Arena standings (read-only public display data): teams, every member's submitted leads, validated
 * sales and close rate for Today / This Week / This Month, rankings and the overall top 3. No customer data.
 */
export async function GET(req: NextRequest) {
  const period = PERIODS[req.nextUrl.searchParams.get("period") ?? "day"];
  if (!period) return NextResponse.json({ ok: false, error: "Choose day, week or month." }, { status: 400 });
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 503 });
  try {
    const s = await cachedStandings(pool, period);
    return NextResponse.json({ ok: true, ...s }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[teams] standings unavailable:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Team standings are unavailable right now." }, { status: 503 });
  }
}
