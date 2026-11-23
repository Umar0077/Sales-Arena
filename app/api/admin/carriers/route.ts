import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/backend/auth/guard";
import {
  CARRIER_WEIGHT_RULES,
  DEFAULT_CARRIER_CREDIT,
  classifyCarrierWeight,
  sqlCarrierWeight,
} from "@/shared/sales/weighting";

export const dynamic = "force-dynamic";

export interface ObservedCarrierRow {
  carrier: string;
  normalizedName: string;
  credit: 0.5 | 1.0;
  category: "Half Credit" | "Full Credit";
  ruleType: "Explicit Override" | "Default Rule";
  matchedRuleId: string;
  matchedRuleName: string;
  precedence: number;
  rawValidatedCount: number;
  creditedTotal: number;
  lastValidatedAt: string | null;
}

export interface HistoricalSwilSaleRow {
  caseId: string;
  userCode: string;
  agentName: string;
  carrier: string;
  validatedAt: string;
  legacyCredit: 0.5;
  correctedCredit: 1.0;
  creditDelta: 0.5;
}

/**
 * Admin read-only Carrier Sales Weighting & Historical SWIL Audit endpoint.
 * Never mutates validated_sales, bonus_awards, or spin_credits.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const rules = [...CARRIER_WEIGHT_RULES];
  const halfCreditCount = rules.filter((r) => r.credit === 0.5).length;
  const fullCreditCount = rules.filter((r) => r.credit === 1.0).length;

  let observedCarriers: ObservedCarrierRow[] = [];
  let swilAudit: {
    databaseAvailable: boolean;
    totalSwilSales: number;
    legacyCreditedTotal: number;
    correctedCreditedTotal: number;
    totalCreditDelta: number;
    affectedAgentsCount: number;
    sales: HistoricalSwilSaleRow[];
  } = {
    databaseAvailable: false,
    totalSwilSales: 0,
    legacyCreditedTotal: 0,
    correctedCreditedTotal: 0,
    totalCreditDelta: 0,
    affectedAgentsCount: 0,
    sales: [],
  };

  try {
    const carrierRes = await auth.pool.query(
      `SELECT
         COALESCE(NULLIF(TRIM(carrier), ''), '(Unspecified Carrier)') AS carrier,
         COUNT(*)::int AS raw_count,
         COALESCE(SUM(${sqlCarrierWeight("carrier")}), 0)::float AS credited_total,
         MAX(validated_at) AS last_validated_at
       FROM validated_sales
       WHERE status = 'validated'
       GROUP BY 1
       ORDER BY raw_count DESC, carrier ASC`,
    );

    observedCarriers = carrierRes.rows.map((r) => {
      const rawCarrier = String(r.carrier);
      const cls = classifyCarrierWeight(
        rawCarrier === "(Unspecified Carrier)" ? "" : rawCarrier,
      );
      return {
        carrier: rawCarrier,
        normalizedName: cls.normalizedName || "(unspecified)",
        credit: cls.credit,
        category: cls.category,
        ruleType: cls.ruleType,
        matchedRuleId: cls.matchedRuleId,
        matchedRuleName: cls.matchedRuleName,
        precedence: cls.precedence,
        rawValidatedCount: Number(r.raw_count) || 0,
        creditedTotal: Number(r.credited_total) || 0,
        lastValidatedAt: r.last_validated_at
          ? new Date(r.last_validated_at).toISOString()
          : null,
      };
    });

    const swilRes = await auth.pool.query(
      `SELECT
         s.case_id,
         s.user_code,
         COALESCE(a.name, s.closer_name, s.user_code) AS agent_name,
         s.carrier,
         s.validated_at
       FROM validated_sales s
       LEFT JOIN agents a ON a.user_code = s.user_code
       WHERE s.status = 'validated'
         AND LOWER(TRIM(COALESCE(s.carrier, ''))) LIKE '%corebridge%'
         AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(s.carrier, ''))), '[-_()/[:space:]]+', ' ', 'g') ~ '(^| )swil( |$)'
       ORDER BY s.validated_at DESC
       LIMIT 200`,
    );

    const sales: HistoricalSwilSaleRow[] = swilRes.rows.map((r) => ({
      caseId: String(r.case_id),
      userCode: String(r.user_code),
      agentName: String(r.agent_name),
      carrier: String(r.carrier),
      validatedAt: new Date(r.validated_at).toISOString(),
      legacyCredit: 0.5,
      correctedCredit: 1.0,
      creditDelta: 0.5,
    }));

    const uniqueAgents = new Set(sales.map((s) => s.userCode));
    const count = sales.length;

    swilAudit = {
      databaseAvailable: true,
      totalSwilSales: count,
      legacyCreditedTotal: count * 0.5,
      correctedCreditedTotal: count * 1.0,
      totalCreditDelta: count * 0.5,
      affectedAgentsCount: uniqueAgents.size,
      sales,
    };
  } catch {
    // Database offline or unavailable: return authoritative static rules cleanly
  }

  return NextResponse.json(
    {
      ok: true,
      summary: {
        halfCreditCarriersCount: halfCreditCount,
        fullCreditCarriersCount: fullCreditCount,
        defaultCredit: DEFAULT_CARRIER_CREDIT,
      },
      rules,
      observedCarriers,
      swilAudit,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
