import { getDbPool } from "../db/client";
import { reconcileRecentSales as reconcile, type SyncReport } from "../sales/sync";

/** Kept for existing imports. Re-checks yesterday + today and stores any missed sales. */
export async function reconcileRecentSales(): Promise<SyncReport> {
  const pool = getDbPool();
  if (!pool) throw new Error("DATABASE_URL is not configured; nothing can be stored.");
  return reconcile(pool);
}

export type { SyncReport };
