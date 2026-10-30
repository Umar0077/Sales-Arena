import { getDbPool } from "../db/client";
import { safeQuoteSseConsumer } from "../safequote/sse-consumer";
import { reconcileRecentSales } from "./sync";

const KEY = Symbol.for("sales_arena.sync_scheduler");
type G = { [KEY]?: { timer: NodeJS.Timeout } };

/** Idempotent: safe to call more than once (hot reload, multiple imports). */
export function startSalesSync(): void {
  const g = globalThis as unknown as G;
  if (g[KEY]) return;
  const pool = getDbPool();
  if (!pool) return;

  safeQuoteSseConsumer.start();

  const minutes = Math.max(1, Number(process.env.SALES_ARENA_RECONCILE_MINUTES) || 5);
  let running = false;
  const run = async () => {
    if (running) return; // never overlap
    running = true;
    try {
      const r = await reconcileRecentSales(pool);
      if (r.inserted || r.errors.length) {
        console.info(`[sales-sync] reconciliation: fetched ${r.fetched}, stored ${r.inserted}, duplicates ${r.duplicates}, errors ${r.errors.length}`);
      }
    } catch (err) {
      console.error("[sales-sync] reconciliation failed:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 30_000); // restart recovery
  g[KEY] = { timer: setInterval(run, minutes * 60_000) };
}
