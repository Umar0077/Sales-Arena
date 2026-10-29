import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/server/admin/auth";
import { dbQuery } from "@/lib/server/db/client";
import { DEFAULT_PROGRAMS, type BonusProgram } from "@/store/rewards-store";

export async function GET(_req: NextRequest) {
  try {
    const res = await dbQuery("SELECT * FROM reward_programs ORDER BY created_at ASC");
    if (res && res.rowCount && res.rowCount > 0) {
      const programs: BonusProgram[] = res.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        enabled: r.enabled,
        salesRequired: r.sales_required,
        amount: Number(r.amount),
        prizeLabel: r.prize_label,
        maxAwards: r.max_awards,
        startDate: r.start_date,
        endDate: r.end_date,
        headline: r.headline,
        message: r.message,
        rewardLine: r.reward_line,
        sound: r.sound,
        accent: r.accent,
        popupSeconds: r.popup_seconds,
        leaderboardCount: r.leaderboard_count,
        activeSince: r.active_since,
      }));
      return NextResponse.json({ ok: true, programs, source: "database" });
    }
  } catch (err) {
    console.warn("[Admin Programs] Falling back to default programs", err);
  }

  return NextResponse.json({ ok: true, programs: DEFAULT_PROGRAMS, source: "defaults" });
}

export async function POST(req: NextRequest) {
  const auth = verifyAdminAuth(req);
  if (!auth.authorized) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  try {
    const body = await req.json();
    const programs: BonusProgram[] = Array.isArray(body?.programs) ? body.programs : [body];

    for (const p of programs) {
      await dbQuery(
        `INSERT INTO reward_programs (
           id, kind, name, enabled, sales_required, amount, prize_label, max_awards, start_date, end_date, headline, message, reward_line, sound, accent, popup_seconds, leaderboard_count, active_since, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
         ON CONFLICT (id) DO UPDATE SET
           kind = EXCLUDED.kind,
           name = EXCLUDED.name,
           enabled = EXCLUDED.enabled,
           sales_required = EXCLUDED.sales_required,
           amount = EXCLUDED.amount,
           prize_label = EXCLUDED.prize_label,
           max_awards = EXCLUDED.max_awards,
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date,
           headline = EXCLUDED.headline,
           message = EXCLUDED.message,
           reward_line = EXCLUDED.reward_line,
           sound = EXCLUDED.sound,
           accent = EXCLUDED.accent,
           popup_seconds = EXCLUDED.popup_seconds,
           leaderboard_count = EXCLUDED.leaderboard_count,
           active_since = EXCLUDED.active_since,
           updated_at = NOW()`,
        [
          p.id,
          p.kind,
          p.name,
          p.enabled,
          p.salesRequired,
          p.amount,
          p.prizeLabel || "",
          p.maxAwards,
          p.startDate || null,
          p.endDate || null,
          p.headline,
          p.message,
          p.rewardLine,
          p.sound,
          p.accent,
          p.popupSeconds,
          p.leaderboardCount,
          p.activeSince || null,
        ]
      );
    }

    return NextResponse.json({ ok: true, message: "Programs saved successfully" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to update programs" },
      { status: 500 }
    );
  }
}
