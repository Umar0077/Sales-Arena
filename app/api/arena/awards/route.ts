import { NextRequest, NextResponse } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { calendarFrom, readArenaConfig } from "@/lib/server/settings/arena-config";
import { periodWindow } from "@/lib/server/spins/rules";

export const dynamic = "force-dynamic";

/**
 * Awards the Live Arena may show (agent name, program, reward, sales count; no customer data), plus
 * earned-cash totals for the CURRENT business day / week / month, computed in PostgreSQL from
 * bonus_awards (each award row counted once; cancelled and reversed awards excluded; "earned" is not
 * "paid"). Hidden programs / categories are excluded. Database failure → 503 (never a fake zero).
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const periodKey = sp.get("periodKey");
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 100));
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 503 });
  try {
    const cfg = (await readArenaConfig(pool)).values;
    const cats = cfg.rewardCategories as Record<string, { showOnArena: boolean }>;
    const visibleKinds = ["daily", "weekly", "monthly"].filter((k) => cats?.[k]?.showOnArena !== false);
    const params: unknown[] = [visibleKinds];
    let where = `a.kind = ANY($1) AND p.show_on_arena AND a.status NOT IN ('reversed', 'cancelled')`;
    if (kind) {
      params.push(kind);
      where += ` AND a.kind = $${params.length}`;
    }
    if (periodKey) {
      params.push(periodKey);
      where += ` AND a.period_key = $${params.length}`;
    }
    params.push(limit);
    const res = await pool.query(
      `SELECT a.id, a.program_id, a.kind, a.agent_id, a.user_code, a.agent_name, a.period_key, a.n, a.validated_at_award, a.amount,
              a.prize_label, a.program_name, a.sales_required, a.reward_type, a.currency, a.announce, a.created_at
         FROM bonus_awards a JOIN reward_programs p ON p.id = a.program_id
        WHERE ${where} ORDER BY a.created_at DESC LIMIT $${params.length}`,
      params,
    );
    const awards = res.rows.map((r) => ({
      id: r.id,
      programId: r.program_id,
      kind: r.kind,
      agentId: r.agent_id || `agt_${r.user_code}`,
      userCode: r.user_code,
      agentName: r.agent_name,
      periodKey: r.period_key,
      n: r.n,
      validatedAtAward: r.validated_at_award,
      amount: Number(r.amount),
      prizeLabel: r.prize_label,
      programName: r.program_name,
      salesRequired: r.sales_required,
      rewardType: r.reward_type,
      currency: r.currency,
      announce: r.announce,
      createdAt: new Date(r.created_at).toISOString(),
    }));

    // Current period keys in the business calendar (same keys the reward engine writes).
    const cal = calendarFrom(cfg);
    const now = new Date();
    const keys = { daily: periodWindow("daily", now, cal).key, weekly: periodWindow("weekly", now, cal).key, monthly: periodWindow("monthly", now, cal).key };
    const totals = await pool.query(
      `SELECT a.kind,
              COUNT(*) FILTER (WHERE a.status NOT IN ('reversed', 'cancelled'))::int AS count,
              COALESCE(SUM(a.amount) FILTER (WHERE a.reward_type = 'cash' AND a.status NOT IN ('reversed', 'cancelled')), 0)::float AS earned,
              COALESCE(SUM(a.amount) FILTER (WHERE a.reward_type = 'cash' AND a.status = 'paid'), 0)::float AS paid,
              MIN(a.currency) FILTER (WHERE a.reward_type = 'cash') AS currency
         FROM bonus_awards a JOIN reward_programs p ON p.id = a.program_id
        WHERE p.show_on_arena AND ((a.kind = 'daily' AND a.period_key = $1) OR (a.kind = 'weekly' AND a.period_key = $2) OR (a.kind = 'monthly' AND a.period_key = $3))
        GROUP BY a.kind`,
      [keys.daily, keys.weekly, keys.monthly],
    );
    const byKind = new Map(totals.rows.map((r) => [r.kind, r]));
    // With no awards yet, label the zero in the currency the active programs use (e.g. PKR).
    const progCurrency = new Map(
      (await pool.query(`SELECT kind, MIN(currency) AS currency FROM reward_programs WHERE archived_at IS NULL AND enabled AND reward_type = 'cash' GROUP BY kind`)).rows.map((r) => [r.kind, r.currency]),
    );
    const fallbackCurrency = String(cfg.currencyLabel || "Rs.");
    const summary = Object.fromEntries(
      (["daily", "weekly", "monthly"] as const).map((k) => {
        const r = byKind.get(k);
        return [k, { periodKey: keys[k], earned: Number(r?.earned ?? 0), paid: Number(r?.paid ?? 0), count: Number(r?.count ?? 0), currency: r?.currency ?? progCurrency.get(k) ?? fallbackCurrency }];
      }),
    );

    // Per-agent earned cash for the leaderboard / podium, in ONE grouped query (not one per row).
    //   today      = daily awards for today
    //   this week  = daily awards dated inside this business week + this week's weekly awards
    //   this month = daily / weekly awards dated in this month + this month's monthly awards
    const weekStart = keys.weekly.slice(2);
    const weekEnd = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10);
    const month = keys.monthly.slice(2);
    const per = await pool.query(
      `SELECT a.user_code,
              COALESCE(SUM(a.amount) FILTER (WHERE a.kind = 'daily' AND a.period_key = $1), 0)::float AS day,
              COUNT(*) FILTER (WHERE a.kind = 'daily' AND a.period_key = $1)::int AS day_n,
              COALESCE(SUM(a.amount) FILTER (WHERE (a.kind = 'daily' AND substr(a.period_key, 3) BETWEEN $2 AND $3) OR (a.kind = 'weekly' AND a.period_key = $4)), 0)::float AS week,
              COUNT(*) FILTER (WHERE (a.kind = 'daily' AND substr(a.period_key, 3) BETWEEN $2 AND $3) OR (a.kind = 'weekly' AND a.period_key = $4))::int AS week_n,
              COALESCE(SUM(a.amount) FILTER (WHERE (a.kind IN ('daily', 'weekly') AND substr(a.period_key, 3, 7) = $5) OR (a.kind = 'monthly' AND a.period_key = $6)), 0)::float AS month,
              COUNT(*) FILTER (WHERE (a.kind IN ('daily', 'weekly') AND substr(a.period_key, 3, 7) = $5) OR (a.kind = 'monthly' AND a.period_key = $6))::int AS month_n,
              MIN(a.currency) AS currency
         FROM bonus_awards a JOIN reward_programs p ON p.id = a.program_id
        WHERE a.reward_type = 'cash' AND a.status NOT IN ('reversed', 'cancelled') AND p.show_on_arena AND a.kind = ANY($7)
          AND (a.period_key IN ($1, $4, $6) OR substr(a.period_key, 3, 7) = $5 OR substr(a.period_key, 3) BETWEEN $2 AND $3)
        GROUP BY a.user_code`,
      [keys.daily, weekStart, weekEnd, keys.weekly, month, keys.monthly, visibleKinds],
    );
    const byAgent = Object.fromEntries(
      per.rows
        .filter((r) => r.day_n + r.week_n + r.month_n > 0)
        .map((r) => [
          String(r.user_code).toUpperCase(),
          {
            currency: r.currency ?? fallbackCurrency,
            day: { earned: Number(r.day), count: r.day_n },
            week: { earned: Number(r.week), count: r.week_n },
            month: { earned: Number(r.month), count: r.month_n },
          },
        ]),
    );
    const agentBonus = { currency: progCurrency.get("daily") ?? progCurrency.get("weekly") ?? progCurrency.get("monthly") ?? fallbackCurrency, byAgent };

    return NextResponse.json({ ok: true, mode: "production", awards, total: awards.length, summary, agentBonus }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Awards are unavailable right now." }, { status: 503 });
  }
}
