import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { readGlobalDisplay } from "@/lib/server/settings/display";

export const dynamic = "force-dynamic";

/** Read-only global display policy for Live Arena screens (no login needed to read). */
export async function GET() {
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, error: "No database configured." }, { status: 503 });
  try {
    const s = await readGlobalDisplay(pool);
    return NextResponse.json({ ok: true, performanceMode: s.performanceMode, revision: s.revision }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Display settings are unavailable right now." }, { status: 503 });
  }
}
