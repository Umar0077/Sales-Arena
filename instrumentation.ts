/**
 * Starts background sales sync when the Node server boots (not during build):
 *  - the Safe Quote SSE consumer (real-time validated sales → PostgreSQL)
 *  - reconciliation every SALES_ARENA_RECONCILE_MINUTES (default 5), plus one run
 *    shortly after boot to recover anything missed while the server was down.
 *
 * Enabled by default in production; in development only with SALES_ARENA_SYNC_ENABLED=true.
 * Requires DATABASE_URL and SALES_ARENA_API_TOKEN. Migrations are never run here.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const flag = process.env.SALES_ARENA_SYNC_ENABLED;
  const enabled = flag === "true" || (flag !== "false" && process.env.NODE_ENV === "production");
  if (!enabled || !process.env.DATABASE_URL || !process.env.SALES_ARENA_API_TOKEN) return;

  const { startSalesSync } = await import("./lib/server/sales/scheduler");
  startSalesSync();
}
