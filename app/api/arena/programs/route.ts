import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { listPrograms, todayIn } from "@/lib/server/rewards/programs";
import { calendarFrom, readArenaConfig } from "@/lib/server/settings/arena-config";

export const dynamic = "force-dynamic";

/**
 * Reward programs the Live Arena shows as currently available (PostgreSQL reward_programs is the only
 * source; nothing is hard-coded). A program is listed only when ALL of these hold:
 *   program enabled · not archived · program show_on_arena · category Program Active · category
 *   Show on Live Arena · today (business timezone) inside its optional start/end dates.
 * Showing a program does not make every agent eligible: eligibility (scope, limits) stays on the
 * server. Eligible agent codes / campaign ids are never exposed, only whether the program is limited.
 */
export async function GET() {
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 503 });
  try {
    const cfg = (await readArenaConfig(pool)).values;
    const cats = cfg.rewardCategories as Record<string, { active: boolean; showOnArena: boolean }>;
    const today = todayIn(calendarFrom(cfg).timezone);
    const programs = (await listPrograms(pool, { publicOnly: true }))
      .filter((p) => cats?.[p.kind]?.active !== false && cats?.[p.kind]?.showOnArena !== false)
      .filter((p) => (!p.startDate || today >= p.startDate) && (!p.endDate || today <= p.endDate))
      .sort((a, b) => a.salesRequired - b.salesRequired || a.createdAt.localeCompare(b.createdAt))
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
        stackable: p.stackable,
        limitedEligibility: p.scopeType !== "all",
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
    return NextResponse.json({ ok: true, today, programs }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Reward programs are unavailable." }, { status: 503 });
  }
}
