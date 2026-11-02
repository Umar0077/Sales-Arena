import { NextRequest, NextResponse } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { readArenaConfig } from "@/lib/server/settings/arena-config";

export const dynamic = "force-dynamic";

/**
 * Recent awards the Live Arena may show (agent name, program, reward, sales count; no customer data).
 * Hidden: categories or programs switched off "Show on Live Arena", and cancelled / reversed awards.
 * Never invents awards: no database → empty list.
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const periodKey = sp.get("periodKey");
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 100));
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: true, mode: "production", awards: [], total: 0 });
  try {
    const cats = (await readArenaConfig(pool)).values.rewardCategories as Record<string, { showOnArena: boolean }>;
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
    return NextResponse.json({ ok: true, mode: "production", awards, total: awards.length }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: true, mode: "production", awards: [], total: 0 });
  }
}
