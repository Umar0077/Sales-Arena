import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/backend/auth/guard";
import { readSpinSettings } from "@/backend/spins/ledger";
import { recoverStaleSpins } from "@/backend/spins/execute";
import { errorResponse } from "@/backend/spins/http";

export const dynamic = "force-dynamic";

/** Spin settings, every rule version (newest first), scopes, and ledger totals. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const db = auth.pool;
    await recoverStaleSpins(db, 90).catch(() => []);
    const [settings, rules, teams, campaigns, totals] = await Promise.all([
      readSpinSettings(db),
      db.query(
        `SELECT r.id, r.scope_type, r.scope_id, r.sales_per_spin, r.spins_per_threshold, r.period, r.enabled, r.effective_from,
                r.superseded_at, r.change_note, r.created_at, u.email AS created_by_email
           FROM target_rules r LEFT JOIN admin_users u ON u.id = r.created_by
          ORDER BY r.effective_from DESC, r.created_at DESC LIMIT 200`,
      ),
      db.query(`SELECT id, name FROM teams ORDER BY name`),
      db.query(`SELECT id, name FROM campaigns ORDER BY name`),
      db.query(
        `SELECT COALESCE(SUM(quantity) FILTER (WHERE kind = 'automatic'), 0)::int AS automatic,
                COALESCE(SUM(quantity) FILTER (WHERE kind = 'manual'), 0)::int AS manual,
                COALESCE(-SUM(quantity) FILTER (WHERE kind = 'consume'), 0)::int AS consumed,
                COALESCE(-SUM(quantity) FILTER (WHERE kind = 'expire'), 0)::int AS expired,
                (SELECT COALESCE(SUM(available), 0)::int FROM spin_credits) AS available,
                (SELECT COUNT(*)::int FROM spin_results WHERE status = 'in-progress' AND created_at > NOW() - INTERVAL '10 minutes') AS in_progress,
                (SELECT COUNT(*)::int FROM spin_results WHERE status = 'completed') AS completed_prizes,
                (SELECT COUNT(*)::int FROM arena_devices WHERE paired_at IS NOT NULL AND revoked_at IS NULL AND last_seen_at > NOW() - INTERVAL '15 minutes') AS connected_tvs
           FROM spin_credit_transactions`,
      ),
    ]);
    return NextResponse.json(
      {
        ok: true,
        settings: {
          ...settings,
          activationCutoff: settings.activationCutoff?.toISOString() ?? null,
          spinCampaignStartAt: settings.spinCampaignStartAt.toISOString(),
          spinCampaignResetAt: settings.spinCampaignResetAt?.toISOString() ?? null,
        },
        timezone: process.env.SALES_ARENA_TIMEZONE || "America/New_York",
        serverTime: new Date().toISOString(),
        rules: rules.rows,
        teams: teams.rows,
        campaigns: campaigns.rows,
        totals: totals.rows[0],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err, "Could not load spin settings from the database.");
  }
}
