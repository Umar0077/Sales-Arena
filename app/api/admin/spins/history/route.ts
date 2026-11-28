import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/backend/auth/guard";
import { errorResponse } from "@/backend/spins/http";

export const dynamic = "force-dynamic";

/**
 * Ledger (?type=ledger, default), spin results (?type=spins), or spin audit logs (?type=audit), newest first.
 * Optional ?userCode= filter; ?limit= up to 500.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const userCode = (sp.get("userCode") ?? "").trim().toUpperCase() || null;
  const limit = Math.min(500, Math.max(1, Number(sp.get("limit")) || 100));
  const type = sp.get("type") ?? "ledger";
  try {
    if (type === "spins" || type === "historical") {
      const { rows } = await auth.pool.query(
        `SELECT r.id, r.user_code, COALESCE(a.name, r.user_code) AS agent_name, r.reward_title, r.reward_color, r.reward_icon, r.mode, r.actor, r.created_at
           FROM spin_results r LEFT JOIN agents a ON a.user_code = r.user_code
          WHERE ($1::varchar IS NULL OR r.user_code = $1)
            AND ($3::boolean = FALSE OR r.mode = 'admin_demo_historical_result')
          ORDER BY r.created_at DESC LIMIT $2`,
        [userCode, limit, type === "historical"],
      );
      return NextResponse.json({ ok: true, spins: rows }, { headers: { "Cache-Control": "no-store" } });
    }
    if (type === "audit") {
      const { rows } = await auth.pool.query(
        `SELECT l.id, l.action, l.target_type, l.target_id, l.details, l.created_at,
                COALESCE(u.email, l.actor) AS actor_label
           FROM audit_logs l
           LEFT JOIN admin_users u ON u.id = l.admin_id
          WHERE l.action LIKE 'spins.%'
            AND ($1::varchar IS NULL OR l.target_id = $1)
          ORDER BY l.created_at DESC LIMIT $2`,
        [userCode, limit],
      );
      return NextResponse.json({ ok: true, audits: rows }, { headers: { "Cache-Control": "no-store" } });
    }
    const { rows } = await auth.pool.query(
      `SELECT t.id, t.user_code, COALESCE(a.name, t.user_code) AS agent_name, t.kind, t.quantity,
              t.balance_before, t.balance_after, t.reason, t.rule_id, t.period_key, t.threshold_n,
              t.sale_id, t.spin_result_id, sr.reward_title, sr.reward_color, t.created_at, u.email AS admin_email
         FROM spin_credit_transactions t
         LEFT JOIN agents a ON a.user_code = t.user_code
         LEFT JOIN admin_users u ON u.id = t.admin_id
         LEFT JOIN spin_results sr ON sr.id = t.spin_result_id
        WHERE $1::varchar IS NULL OR t.user_code = $1
        ORDER BY t.id DESC LIMIT $2`,
      [userCode, limit],
    );
    return NextResponse.json({ ok: true, transactions: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Could not load history from the database.");
  }
}
