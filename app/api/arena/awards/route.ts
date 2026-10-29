import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/server/db/client";
import type { BonusAward } from "@/store/rewards-store";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") || undefined;
  const periodKey = searchParams.get("periodKey") || undefined;
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));

  try {
    let query = `
      SELECT 
        id, program_id, kind, agent_id, user_code, agent_name, 
        period_key, n, validated_at_award, amount, prize_label, 
        program_name, sales_required, status, created_at
      FROM bonus_awards
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (kind) {
      params.push(kind);
      query += ` AND kind = $${params.length}`;
    }

    if (periodKey) {
      params.push(periodKey);
      query += ` AND period_key = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const res = await dbQuery(query, params);

    if (res && res.rows) {
      const awards: BonusAward[] = res.rows.map((r) => ({
        id: r.id,
        programId: r.program_id,
        kind: r.kind,
        agentId: r.agent_id || `agt_${r.user_code.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
        agentName: r.agent_name,
        periodKey: r.period_key,
        n: r.n,
        validatedAtAward: r.validated_at_award,
        amount: Number(r.amount),
        prizeLabel: r.prize_label,
        programName: r.program_name,
        salesRequired: r.sales_required,
        createdAt: r.created_at,
      }));

      return NextResponse.json({
        ok: true,
        mode: "production",
        awards,
        total: awards.length,
      });
    }
  } catch (err) {
    // If table doesn't exist or database not connected, return empty list (never invent awards!)
  }

  return NextResponse.json({
    ok: true,
    mode: "production",
    awards: [],
    total: 0,
  });
}
