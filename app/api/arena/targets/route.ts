import { NextResponse, type NextRequest } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { readTargets } from "@/lib/server/targets/store";

export const dynamic = "force-dynamic";

/**
 * Read-only targets for the Live Arena: ?day=YYYY-MM-DD&week=YYYY-MM-DD&month=YYYY-MM-DD
 * (each the first business date of its period). Returns numbers only; never writes.
 */
export async function GET(req: NextRequest) {
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, error: "Targets are unavailable: the database is not configured." }, { status: 503 });
  const p = req.nextUrl.searchParams;
  try {
    const t = await readTargets(pool, { day: p.get("day") ?? undefined, week: p.get("week") ?? undefined, month: p.get("month") ?? undefined });
    const pick = (x: (typeof t)["day"]) => (x ? { target: x.target, updatedAt: x.updatedAt } : null);
    return NextResponse.json({ ok: true, targets: { day: pick(t.day), week: pick(t.week), month: pick(t.month) } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Targets are unavailable right now." }, { status: 503 });
  }
}
