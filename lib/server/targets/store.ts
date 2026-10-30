import type { Pool } from "pg";
import { isValidPeriodKey, type TargetPeriod } from "@/lib/live/targets";
import { writeAudit } from "@/lib/server/auth/guard";

export interface StoredTarget {
  periodType: TargetPeriod;
  periodKey: string;
  target: number;
  note: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

const toKey = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** Targets for the given period keys (e.g. today, this week, this month). Read-only. */
export async function readTargets(pool: Pool, keys: Partial<Record<TargetPeriod, string>>): Promise<Record<TargetPeriod, StoredTarget | null>> {
  const out: Record<TargetPeriod, StoredTarget | null> = { day: null, week: null, month: null };
  const pairs = (Object.entries(keys) as Array<[TargetPeriod, string]>).filter(([, k]) => isValidPeriodKey(k));
  if (pairs.length === 0) return out;
  const { rows } = await pool.query(
    `SELECT t.period_type, t.period_key::text AS period_key, t.target, t.note, t.updated_at, u.email AS updated_by
       FROM sales_targets t LEFT JOIN admin_users u ON u.id = t.updated_by
      WHERE (t.period_type, t.period_key) IN (SELECT * FROM UNNEST($1::varchar[], $2::date[]))`,
    [pairs.map((p) => p[0]), pairs.map((p) => p[1])],
  );
  for (const r of rows) {
    out[r.period_type as TargetPeriod] = {
      periodType: r.period_type,
      periodKey: toKey(r.period_key),
      target: Number(r.target),
      note: r.note,
      updatedAt: new Date(r.updated_at).toISOString(),
      updatedBy: r.updated_by ?? null,
    };
  }
  return out;
}

export class TargetError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Upserts one period's target in a transaction and records history + an audit entry. */
export async function saveTarget(
  pool: Pool,
  input: { periodType: unknown; periodKey: unknown; target: unknown; note?: unknown },
  actor: { adminId: string; ip: string | null; userAgent: string | null },
): Promise<{ target: StoredTarget; previous: number | null }> {
  const periodType = input.periodType;
  if (periodType !== "day" && periodType !== "week" && periodType !== "month") throw new TargetError(400, "Choose day, week or month.");
  if (!isValidPeriodKey(input.periodKey)) throw new TargetError(400, "Choose a valid date (YYYY-MM-DD).");
  const periodKey = input.periodKey;
  const target = Number(input.target);
  if (!Number.isInteger(target) || target < 0 || target > 1_000_000) throw new TargetError(400, "Target must be a whole number between 0 and 1,000,000.");
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 300) : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise saves for this period (also when no row exists yet) so history forms a clean chain.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('sales_target:' || $1 || ':' || $2))`, [periodType, periodKey]);
    const prev = await client.query(`SELECT target FROM sales_targets WHERE period_type = $1 AND period_key = $2 FOR UPDATE`, [periodType, periodKey]);
    const previous = prev.rows[0] ? Number(prev.rows[0].target) : null;
    const { rows } = await client.query(
      `INSERT INTO sales_targets (period_type, period_key, target, note, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (period_type, period_key)
       DO UPDATE SET target = EXCLUDED.target, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING id, period_key::text AS period_key, updated_at`,
      [periodType, periodKey, target, note, actor.adminId],
    );
    await client.query(
      `INSERT INTO sales_target_history (target_id, period_type, period_key, old_target, new_target, note, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [rows[0].id, periodType, periodKey, previous, target, note, actor.adminId],
    );
    await writeAudit(client, {
      adminId: actor.adminId,
      action: "target.updated",
      targetType: "sales_target",
      targetId: `${periodType}:${periodKey}`,
      details: { periodType, periodKey, from: previous, to: target, note },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    const email = (await client.query(`SELECT email FROM admin_users WHERE id = $1`, [actor.adminId])).rows[0]?.email ?? null;
    await client.query("COMMIT");
    return {
      previous,
      target: { periodType, periodKey: toKey(rows[0].period_key), target, note, updatedAt: new Date(rows[0].updated_at).toISOString(), updatedBy: email },
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function targetHistory(pool: Pool, limit = 50) {
  const { rows } = await pool.query(
    `SELECT h.id, h.period_type, h.period_key::text AS period_key, h.old_target, h.new_target, h.note, h.changed_at, u.email AS changed_by
       FROM sales_target_history h LEFT JOIN admin_users u ON u.id = h.changed_by
      ORDER BY h.changed_at DESC, h.id DESC LIMIT $1`,
    [Math.min(Math.max(1, limit), 200)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    periodType: r.period_type as TargetPeriod,
    periodKey: toKey(r.period_key),
    oldTarget: r.old_target === null ? null : Number(r.old_target),
    newTarget: Number(r.new_target),
    note: (r.note as string | null) ?? null,
    changedAt: new Date(r.changed_at).toISOString(),
    changedBy: (r.changed_by as string | null) ?? null,
  }));
}
