import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/auth/guard";
import { readSpinSettings } from "@/lib/server/spins/ledger";
import { errorResponse } from "@/lib/server/spins/http";

export const dynamic = "force-dynamic";

/** Spin settings, every rule version (newest first), scopes, and ledger totals. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const db = auth.pool;
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
                (SELECT COALESCE(SUM(available), 0)::int FROM spin_credits) AS available
           FROM spin_credit_transactions`,
      ),
    ]);
    return NextResponse.json(
      {
        ok: true,
        settings: { ...settings, activationCutoff: settings.activationCutoff?.toISOString() ?? null },
        timezone: process.env.SALES_ARENA_TIMEZONE || "America/New_York",
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
