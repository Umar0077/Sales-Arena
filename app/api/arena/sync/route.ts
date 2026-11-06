import { NextResponse } from "next/server";
import { getDbPool } from "@/database/client";
import { readSyncState } from "@/backend/live/sync-state";

export const dynamic = "force-dynamic";

/**
 * Background sync check for Live Arena displays and Admin tabs (read-only, PostgreSQL only): dataset
 * fingerprints, settings revisions and the sales stored in the last few minutes. Public sale fields only
 * (case id, closer, times, source); no customer data. Shared by all callers for 2 s (backend/live/sync-state.ts).
 */
export async function GET() {
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 503 });
  try {
    const state = await readSyncState(pool);
    return NextResponse.json({ ok: true, ...state }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Live data is unavailable right now." }, { status: 503 });
  }
}
