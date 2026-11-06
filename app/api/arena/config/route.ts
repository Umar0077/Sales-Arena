import { NextResponse } from "next/server";
import { getDbPool } from "@/database/client";
import { readArenaConfig, readScreenSwitch } from "@/backend/settings/arena-config";

export const dynamic = "force-dynamic";

/** Read-only global display configuration for Live Arena screens (no secrets, no admin data). */
export async function GET() {
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 503 });
  try {
    const [c, screen] = await Promise.all([readArenaConfig(pool), readScreenSwitch(pool)]);
    return NextResponse.json({ ok: true, revision: c.revision, values: c.values, screen }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Settings are unavailable." }, { status: 503 });
  }
}
