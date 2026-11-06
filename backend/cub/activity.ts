import type { Pool, PoolClient } from "pg";

/**
 * Latest validated sale still counted as validated (returned / rejected sales excluded). Read-only.
 * A timestamp in the future (clock skew in the source) is ignored so the cub never looks "just fed" forever.
 */
export async function readLastSaleAt(db: Pool | PoolClient): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT MAX(validated_at) AS at FROM validated_sales WHERE status = 'validated' AND validated_at <= NOW() + INTERVAL '5 minutes'`,
  );
  const at = rows[0]?.at as Date | null | undefined;
  return at ? new Date(at).toISOString() : null;
}
