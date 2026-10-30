import type { Pool } from "pg";
import { getSafeQuoteClient } from "../safequote/client";
import { extractCloserIdentity } from "../safequote/mapper";
import { ingestValidatedSale, type SaleSource } from "./ingest";

/**
 * Reconciliation and historical backfill from Safe Quote /recent-sales.
 *
 * Honest accounting: /recent-sales returns at most SAFEQUOTE_RECENT_SALES_LIMIT items
 * per request (default 50). When a request returns that many, the result may be
 * truncated; we record it as "possibly incomplete" and compare against the upstream
 * /summary validated count. We never invent sales we did not receive.
 */

export const RECENT_SALES_LIMIT = Math.max(1, Number(process.env.SAFEQUOTE_RECENT_SALES_LIMIT) || 50);

export interface SyncReport {
  source: SaleSource;
  from: string;
  to: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  invalid: number;
  spinGrants: number;
  bonusAwards: number;
  upstreamValidated: number | null;
  possiblyIncompleteDays: string[];
  errors: string[];
}

function ymd(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  for (let t = a.getTime(); t <= b.getTime() && out.length <= 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

async function saveCheckpoint(pool: Pool, id: string, endpoint: string, report: SyncReport, ok: boolean) {
  await pool.query(
    `INSERT INTO sync_checkpoints (id, endpoint, last_sync_at, status, error, details, updated_at)
     VALUES ($1, $2, NOW(), $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET last_sync_at = NOW(), status = EXCLUDED.status, error = EXCLUDED.error, details = EXCLUDED.details, updated_at = NOW()`,
    [id, endpoint, ok ? (report.possiblyIncompleteDays.length ? "partial" : "success") : "error", report.errors[0]?.slice(0, 1000) ?? null, JSON.stringify(report)],
  );
}

async function importDays(pool: Pool, days: string[], source: SaleSource): Promise<SyncReport> {
  const client = getSafeQuoteClient();
  const report: SyncReport = {
    source, from: days[0], to: days[days.length - 1], fetched: 0, inserted: 0, duplicates: 0, invalid: 0,
    spinGrants: 0, bonusAwards: 0, upstreamValidated: null, possiblyIncompleteDays: [], errors: [],
  };
  if (!client.isConfigured()) {
    report.errors.push("Safe Quote API token is not configured.");
    return report;
  }
  for (const day of days) {
    let sales;
    try {
      sales = (await client.getRecentSales({ from: day, to: day }, true)).sales;
    } catch (err) {
      report.errors.push(`${day}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    report.fetched += sales.length;
    if (sales.length >= RECENT_SALES_LIMIT) report.possiblyIncompleteDays.push(day);
    for (const s of sales) {
      const { userCode, name } = extractCloserIdentity(s.closer);
      try {
        const r = await ingestValidatedSale(
          pool,
          { caseId: s.caseId, userCode, closerName: name, state: s.state, carrier: s.carrier, coverage: s.coverage, premium: s.premium, validatedAt: s.validatedAt },
          source,
        );
        if (r.status === "inserted") report.inserted++;
        else if (r.status === "duplicate") report.duplicates++;
        else report.invalid++;
        report.spinGrants += r.spinGrants.length;
        report.bonusAwards += r.bonuses.length;
      } catch (err) {
        report.errors.push(`case ${s.caseId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  try {
    report.upstreamValidated = (await client.getSummary({ from: report.from, to: report.to }, true)).validated;
  } catch {
    report.upstreamValidated = null;
  }
  return report;
}

/**
 * Re-checks yesterday and today (business timezone) and stores anything SSE missed.
 * Sales found here are genuine live sales: eligible for rewards if after the cutoff.
 */
export async function reconcileRecentSales(pool: Pool): Promise<SyncReport> {
  const tz = process.env.SALES_ARENA_TIMEZONE || "America/New_York";
  const today = ymd(new Date(), tz);
  const yesterday = ymd(new Date(Date.now() - 86_400_000), tz);
  const report = await importDays(pool, [yesterday, today], "reconciliation");
  await saveCheckpoint(pool, "reconciliation", "/recent-sales", report, report.errors.length === 0);
  return report;
}

/**
 * Historical import. Stores sales as source = 'backfill': never reward-eligible,
 * so it can never grant spins or bonuses, however recent the sales are.
 */
export async function backfillSales(pool: Pool, from: string, to: string): Promise<SyncReport> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error("Use from/to dates as YYYY-MM-DD with from ≤ to.");
  const days = daysBetween(from, to);
  if (days.length > 93) throw new Error("Backfill at most 93 days per run.");
  const report = await importDays(pool, days, "backfill");
  await saveCheckpoint(pool, "backfill", "/recent-sales", report, report.errors.length === 0);
  return report;
}
