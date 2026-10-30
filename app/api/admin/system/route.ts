import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/auth/guard";
import { getMigrationStatus } from "@/lib/server/db/migrations";
import { getSafeQuoteClient } from "@/lib/server/safequote/client";
import { safeQuoteSseConsumer } from "@/lib/server/safequote/sse-consumer";
import { RECENT_SALES_LIMIT } from "@/lib/server/sales/sync";

export const dynamic = "force-dynamic";

const COUNTED = [
  "agents", "validated_sales", "sales_events_inbox", "spin_credits", "spin_credit_transactions", "manual_spin_allocations",
  "automatic_spin_awards", "spin_results", "rewards_catalog", "bonus_awards", "admin_users", "audit_logs",
] as const;

/** Database, migration, Safe Quote API and SSE health, record counts, sync checkpoints and recent privileged activity. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = auth.pool;
  const out: Record<string, unknown> = { ok: true, generatedAt: new Date().toISOString() };
  try {
    const t0 = Date.now();
    const info = await db.query(`SELECT current_database() AS db, version() AS version`);
    out.database = { connected: true, name: info.rows[0].db, version: String(info.rows[0].version).split(" on ")[0], latencyMs: Date.now() - t0 };
    const counts: Record<string, number> = {};
    for (const t of COUNTED) counts[t] = (await db.query(`SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n; // fixed identifiers
    out.counts = counts;
    out.sales = (
      await db.query(
        `SELECT COUNT(*) FILTER (WHERE source = 'backfill')::int AS backfill, COUNT(*) FILTER (WHERE source = 'sse')::int AS sse,
                COUNT(*) FILTER (WHERE source = 'reconciliation')::int AS reconciliation, COUNT(*) FILTER (WHERE reward_eligible)::int AS reward_eligible,
                MAX(validated_at) AS latest_validated_at, MAX(first_seen_at) AS latest_stored_at
           FROM validated_sales`,
      )
    ).rows[0];
    out.checkpoints = (await db.query(`SELECT id, endpoint, last_sync_at, last_event_id, status, error, details FROM sync_checkpoints ORDER BY id`)).rows;
    out.audit = (
      await db.query(
        `SELECT l.id, l.actor, l.action, l.target_type, l.target_id, l.details, l.ip_address, l.created_at, u.email AS admin_email
           FROM audit_logs l LEFT JOIN admin_users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 50`,
      )
    ).rows;
  } catch (err) {
    out.ok = false;
    out.database = { connected: false, error: err instanceof Error ? err.message : String(err) };
  }
  out.migrations = await getMigrationStatus();
  const sq = getSafeQuoteClient();
  out.safeQuote = sq.isConfigured() ? await sq.checkHealth() : { ok: false, error: "API token not configured" };
  out.sse = safeQuoteSseConsumer.getHealth();
  out.syncEnabled = syncEnabled();
  out.recentSalesLimit = RECENT_SALES_LIMIT;
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}

function syncEnabled(): boolean {
  const v = process.env.SALES_ARENA_SYNC_ENABLED;
  return v === "true" || (v !== "false" && process.env.NODE_ENV === "production");
}
