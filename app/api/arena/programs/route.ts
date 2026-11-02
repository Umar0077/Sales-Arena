import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { listPrograms } from "@/lib/server/rewards/programs";
import { readArenaConfig } from "@/lib/server/settings/arena-config";

export const dynamic = "force-dynamic";

/** Reward programs the Live Arena may show: Program Active + Show on Live Arena, in a visible category. */
export async function GET() {
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 503 });
  try {
    const cats = (await readArenaConfig(pool)).values.rewardCategories as Record<string, { showOnArena: boolean }>;
    const programs = (await listPrograms(pool, { publicOnly: true }))
      .filter((p) => cats?.[p.kind]?.showOnArena !== false && p.status === "active")
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        name: p.name,
        description: p.description,
        rewardType: p.rewardType,
        amount: p.amount,
        currency: p.currency,
        prizeLabel: p.prizeLabel,
        salesRequired: p.salesRequired,
        maxAwards: p.maxAwards,
        startDate: p.startDate,
        endDate: p.endDate,
        headline: p.headline,
        message: p.message,
        rewardLine: p.rewardLine,
        sound: p.sound,
        accent: p.accent,
        popupSeconds: p.popupSeconds,
        leaderboardCount: p.leaderboardCount,
        activeSince: p.activeSince,
        revision: p.revision,
        enabled: p.enabled,
        showOnArena: p.showOnArena,
      }));
    return NextResponse.json({ ok: true, programs }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Reward programs are unavailable." }, { status: 503 });
  }
}
