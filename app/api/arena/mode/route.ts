import { NextResponse } from "next/server";
import { getSafeQuoteClient } from "@/backend/safequote/client";
import { getDbPool } from "@/database/client";
import { readGlobalDisplay } from "@/backend/settings/display";
import { readArenaConfig, readScreenSwitch } from "@/backend/settings/arena-config";

export const dynamic = "force-dynamic";

/**
 * First request every display makes, before anything renders: live vs demo data, the admin's
 * global performance mode and the global arena configuration (screens, on/off, rewards, sound...).
 * No upstream call, no secrets.
 */
export async function GET() {
  const live = getSafeQuoteClient().isConfigured() && process.env.SALES_ARENA_MODE !== "demo";
  let display: { performanceMode: string; revision: number } | null = null;
  let config: { revision: number; values: Record<string, unknown>; screen: unknown } | null = null;
  const pool = getDbPool();
  if (pool) {
    try {
      const [s, c, screen] = await Promise.all([readGlobalDisplay(pool), readArenaConfig(pool), readScreenSwitch(pool)]);
      display = { performanceMode: s.performanceMode, revision: s.revision };
      config = { revision: c.revision, values: c.values, screen };
    } catch {
      // the display keeps its last verified settings until the next check
    }
  }
  return NextResponse.json({ ok: true, live, display, config }, { headers: { "Cache-Control": "no-store" } });
}
