import { getDbPool } from "./client";
import { migrationStatus } from "./migrate-core.mjs";

/**
 * Migration status for the admin System page. Applying migrations is deliberately
 * NOT exposed over HTTP: run `npm run db:migrate` from a shell (see docs/DEPLOYMENT.md).
 */
export async function getMigrationStatus() {
  const pool = getDbPool();
  if (!pool) return { ok: false as const, error: "DATABASE_URL not configured" };
  try {
    const versions = await migrationStatus(pool);
    return { ok: true as const, versions, pending: versions.filter((v) => !v.applied).map((v) => v.version) };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}
