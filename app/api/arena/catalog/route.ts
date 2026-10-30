import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { loadWheelCatalog } from "@/lib/server/rewards/catalog";

export const dynamic = "force-dynamic";

/** Read-only wheel catalog for Live Arena displays (PostgreSQL is the source of truth). */
export async function GET() {
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, error: "The prize catalog is unavailable: no database." }, { status: 503 });
  try {
    const { prizes, revision } = await loadWheelCatalog(pool);
    return NextResponse.json({ ok: true, revision, prizes, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "The prize catalog is unavailable right now." }, { status: 503 });
  }
}
