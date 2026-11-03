import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { readLastSaleAt } from "@/lib/server/cub/activity";

export const dynamic = "force-dynamic";

/**
 * Arena Cub activity (read-only, no personal data): the time of the latest genuine validated sale in
 * PostgreSQL and the server clock. Every display computes the cub's mood from these same values, so
 * all screens agree and a browser refresh never restarts the inactivity count.
 */
export async function GET() {
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 503 });
  try {
    const lastSaleAt = await readLastSaleAt(pool);
    return NextResponse.json({ ok: true, lastSaleAt, serverNow: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Activity is unavailable." }, { status: 503 });
  }
}
