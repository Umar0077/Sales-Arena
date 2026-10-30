import { NextResponse } from "next/server";
import { getSafeQuoteClient } from "@/lib/server/safequote/client";
import { getDbPool } from "@/lib/server/db/client";
import { readGlobalDisplay } from "@/lib/server/settings/display";

export const dynamic = "force-dynamic";

/**
 * First request every display makes, before anything renders: live vs demo data, and the
 * admin's global display policy (so the right quality applies before heavy graphics start).
 * No upstream call, no secrets.
 */
export async function GET() {
  const live = getSafeQuoteClient().isConfigured() && process.env.SALES_ARENA_MODE !== "demo";
  let display: { performanceMode: string; revision: number } | null = null;
  const pool = getDbPool();
  if (pool) {
    try {
      const s = await readGlobalDisplay(pool);
      display = { performanceMode: s.performanceMode, revision: s.revision };
    } catch {
      display = null; // display keeps its last verified setting until the next check
    }
  }
  return NextResponse.json({ ok: true, live, display }, { headers: { "Cache-Control": "no-store" } });
}
