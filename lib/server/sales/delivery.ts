import type { Pool } from "pg";

/**
 * Live delivery timeline from PostgreSQL (read-only). Per recent validated sale:
 *   validated_at (Safe Quote) → first_seen_at (stored here; = receipt for the live stream) → award created_at.
 * source tells HOW it was discovered: "sse" = Safe Quote's live stream (seconds), "reconciliation" = the
 * periodic recent-sales poll (up to SALES_ARENA_RECONCILE_MINUTES later), "backfill" = historical import.
 */

export interface DeliveryRow {
  caseId: string;
  agentName: string | null;
  source: string;
  validatedAt: string;
  storedAt: string;
  discoverySec: number;
  awardCreatedAt: string | null;
  awardSec: number | null;
}
export interface SourceSummary {
  source: string;
  sales: number;
  medianSec: number | null;
  p95Sec: number | null;
  maxSec: number | null;
}

export async function deliveryTimeline(db: Pool, opts: { limit?: number; days?: number } = {}): Promise<{ recent: DeliveryRow[]; bySource: SourceSummary[] }> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 30));
  const days = Math.min(31, Math.max(1, opts.days ?? 7));
  const recent = await db.query(
    `SELECT s.case_id, s.closer_name, s.source, s.validated_at, s.first_seen_at,
            EXTRACT(EPOCH FROM (s.first_seen_at - s.validated_at))::float AS discovery_sec,
            a.created_at AS award_created_at,
            EXTRACT(EPOCH FROM (a.created_at - s.first_seen_at))::float AS award_sec
       FROM validated_sales s
       LEFT JOIN LATERAL (SELECT MIN(created_at) AS created_at FROM bonus_awards b WHERE b.trigger_case_id = s.case_id) a ON TRUE
      WHERE s.source <> 'backfill'
      ORDER BY s.first_seen_at DESC
      LIMIT $1`,
    [limit],
  );
  const summary = await db.query(
    `SELECT source, COUNT(*)::int AS sales,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_seen_at - validated_at))) AS median_sec,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_seen_at - validated_at))) AS p95_sec,
            MAX(EXTRACT(EPOCH FROM (first_seen_at - validated_at)))::float AS max_sec
       FROM validated_sales
      WHERE source <> 'backfill' AND first_seen_at > NOW() - make_interval(days => $1)
      GROUP BY source ORDER BY source`,
    [days],
  );
  const n = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
  return {
    recent: recent.rows.map((r) => ({
      caseId: r.case_id,
      agentName: r.closer_name,
      source: r.source,
      validatedAt: new Date(r.validated_at).toISOString(),
      storedAt: new Date(r.first_seen_at).toISOString(),
      discoverySec: n(r.discovery_sec) ?? 0,
      awardCreatedAt: r.award_created_at ? new Date(r.award_created_at).toISOString() : null,
      awardSec: n(r.award_sec),
    })),
    bySource: summary.rows.map((r) => ({ source: r.source, sales: r.sales, medianSec: n(r.median_sec), p95Sec: n(r.p95_sec), maxSec: n(r.max_sec) })),
  };
}
