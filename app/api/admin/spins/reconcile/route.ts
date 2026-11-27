import { NextResponse, type NextRequest } from "next/server";
import type { Pool, PoolClient } from "pg";
import { requireAdmin, jsonError } from "@/backend/auth/guard";
import { errorResponse, readJson } from "@/backend/spins/http";
import { grantAutomaticSpins, businessCalendar, readSpinSettings } from "@/backend/spins/ledger";
import { arenaBroadcaster } from "@/backend/events/broadcaster";

export const dynamic = "force-dynamic";

/**
 * Read-only audit report (GET) and idempotent reconciliation (POST) for the spin credit ledger.
 *
 * GET  → Report: for each eligible agent, expected vs. actual credits across every active rule.
 *        Zero writes — safe to run at any time.
 *
 * POST { dryRun: true }             → Same as GET but formatted as a JSON report.
 * POST { dryRun: false, agentIds: ["ALICE", "BOB"] } → Grants only the missing credits for the
 *        listed agents, using the same grantAutomaticSpins() path as the live pipeline (idempotent).
 *        Requires explicit admin approval; never commits without agentIds.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const report = await buildReport(auth.pool);
    return NextResponse.json({ ok: true, report }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Could not build reconciliation report.");
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const body = await readJson<{ dryRun?: unknown; agentIds?: unknown }>(req);
  if (!body) return jsonError(400, "Invalid request body.");
  const dryRun = body.dryRun !== false; // safe default: always dry-run unless explicitly false

  try {
    const report = await buildReport(auth.pool);
    if (dryRun) return NextResponse.json({ ok: true, dryRun: true, report });

    const agentIds = Array.isArray(body.agentIds) ? (body.agentIds as unknown[]).map(String) : null;
    if (!agentIds || agentIds.length === 0) return jsonError(400, "agentIds (array of userCodes) is required for a live reconciliation run.");

    // Filter the report to only the requested agents with a deficit.
    const targets = report.filter(
      (r) => agentIds.includes(r.userCode) && r.missingCredits > 0,
    );
    if (targets.length === 0)
      return NextResponse.json({ ok: true, dryRun: false, granted: [], message: "No missing credits for the requested agents." });

    const settings = await readSpinSettings(auth.pool);
    if (!settings.autoEnabled || !settings.activationCutoff) {
      return jsonError(400, "Automatic spins are disabled or no activation cutoff is set. Enable them in Rules & Settings first.");
    }

    const granted: Array<{ userCode: string; name: string; grantsAdded: number }> = [];
    const cal = businessCalendar();

    for (const target of targets) {
      // Trigger grantAutomaticSpins for the agent using a synthetic "last eligible sale".
      // We pick the most-recent validated sale so the rule/period resolution is accurate.
      const { rows: saleRows } = await auth.pool.query<{ id: string; validated_at: string }>(
        `SELECT id, validated_at FROM validated_sales
          WHERE user_code = $1 AND reward_eligible AND status = 'validated'
          ORDER BY validated_at DESC LIMIT 1`,
        [target.userCode],
      );
      if (!saleRows.length) continue;

      const client = await auth.pool.connect();
      let grantsAdded = 0;
      try {
        await client.query("BEGIN");
        const grants = await grantAutomaticSpins(client, {
          userCode: target.userCode,
          triggerSaleId: saleRows[0].id,
          validatedAt: new Date(saleRows[0].validated_at),
          calendar: cal,
        });
        await client.query("COMMIT");
        grantsAdded = grants.filter((g) => !g).length; // non-replayed grants
        // Broadcast each new grant.
        for (const g of grants) {
          arenaBroadcaster.broadcast("spin.unlocked", {
            eventId: `tx:${g.transactionId}`,
            origin: "automatic",
            userCode: target.userCode,
            closerName: target.name,
            quantity: g.quantity,
            salesCounted: g.salesCounted,
            spinsAvailable: g.balanceAfter,
          });
        }
        granted.push({ userCode: target.userCode, name: target.name, grantsAdded: grants.length });
      } catch {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      grantsAdded; // suppress unused warning
    }

    return NextResponse.json({ ok: true, dryRun: false, granted });
  } catch (err) {
    return errorResponse(err, "Reconciliation failed.");
  }
}

interface ReportRow {
  userCode: string;
  name: string;
  rawValidatedSales: number;
  actualCredits: number;
  expectedCredits: number;
  missingCredits: number;
  rule: string | null;
}

/** Builds the reconciliation report without writing anything to the database. */
async function buildReport(pool: Pool | PoolClient): Promise<ReportRow[]> {
  const settings = await readSpinSettings(pool);
  if (!settings.autoEnabled || !settings.activationCutoff) {
    return []; // automatic spins off — nothing to reconcile
  }
  const cutoff = settings.activationCutoff;

  // Agents with at least one eligible sale since the cutoff.
  const { rows: agentRows } = await pool.query<{
    user_code: string;
    name: string;
    raw_sales: number;
    auto_earned: number;
    rule_id: string | null;
    sales_per_spin: number | null;
  }>(
    `SELECT a.user_code, a.name,
            COUNT(*)::int AS raw_sales,
            COALESCE(c.auto_earned, 0)::int AS auto_earned,
            r.id AS rule_id,
            r.sales_per_spin
       FROM agents a
       JOIN validated_sales vs ON vs.user_code = a.user_code
         AND vs.reward_eligible AND vs.status = 'validated'
         AND vs.validated_at >= $1
       LEFT JOIN spin_credits c ON c.user_code = a.user_code
       LEFT JOIN LATERAL (
         SELECT id, sales_per_spin
           FROM target_rules
          WHERE scope_type = 'global' AND superseded_at IS NULL
         LIMIT 1
       ) r ON TRUE
      WHERE a.spin_eligible
      GROUP BY a.user_code, a.name, c.auto_earned, r.id, r.sales_per_spin
      ORDER BY a.name`,
    [cutoff],
  );

  return agentRows.map((r) => {
    const salesPerSpin = r.sales_per_spin ?? 2;
    const expected = Math.floor(r.raw_sales / salesPerSpin);
    const actual = r.auto_earned;
    return {
      userCode: r.user_code,
      name: r.name,
      rawValidatedSales: r.raw_sales,
      actualCredits: actual,
      expectedCredits: expected,
      missingCredits: Math.max(0, expected - actual),
      rule: r.rule_id,
    };
  });
}
