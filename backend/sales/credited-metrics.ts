import type { Pool } from "pg";
import { getDbPool } from "@/database/client";
import { sqlCarrierWeight } from "@/shared/sales/weighting";
import { calendarFrom, readArenaConfig } from "@/backend/settings/arena-config";
import type { SafeQuoteCloserItem } from "@/backend/safequote/schemas";

export interface SalesRange { from?: string; to?: string }
export interface CreditedTotal { validated: number; rawValidated: number }

/** Read all validated transactions, including backfill, without reward-eligibility filters.
 * Date endpoints are inclusive business dates, just like the public Arena requests.
 * Never fall back to raw counts when the database is unavailable.
 */
export async function creditedMetrics(range: SalesRange, group: "all" | "user" | "state" = "all", db: Pool | null = getDbPool()) {
  if (!db) throw new Error("Credited sales database is unavailable");
  const { timezone } = calendarFrom((await readArenaConfig(db)).values);
  const key = group === "user" ? "UPPER(TRIM(user_code))" : group === "state" ? "UPPER(TRIM(state))" : "'all'::text";
  const { rows } = await db.query(
    `SELECT ${key} AS key, SUM(${sqlCarrierWeight("carrier")}) AS credited, COUNT(*)::int AS raw
       FROM validated_sales WHERE status = 'validated'
       AND ($1::date IS NULL OR validated_at >= ($1::date::timestamp AT TIME ZONE $3))
       AND ($2::date IS NULL OR validated_at < (($2::date + 1)::timestamp AT TIME ZONE $3))
       GROUP BY 1`,
    [range.from || null, range.to || null, timezone],
  );
  return new Map<string, CreditedTotal>(rows.map((r) => [r.key, { validated: Number(r.credited), rawValidated: Number(r.raw) }]));
}

export function withCredits<T extends { submitted: number; validated: number; closeRate: number }>(row: T, total?: CreditedTotal): T & CreditedTotal {
  const validated = total?.validated ?? 0;
  return { ...row, validated, rawValidated: total?.rawValidated ?? 0, closeRate: row.submitted > 0 ? validated / row.submitted * 100 : 0 };
}

export async function creditClosers(closers: SafeQuoteCloserItem[], range: SalesRange, db?: Pool) {
  const totals = await creditedMetrics(range, "user", db);
  return closers.map((c) => withCredits(c, totals.get(c.userCode.trim().toUpperCase())))
    .sort((a, b) => b.validated - a.validated || b.submitted - a.submitted || a.name.localeCompare(b.name))
    .map((c, i) => ({ ...c, rank: i + 1 }));
}
