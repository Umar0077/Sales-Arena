import { getDbPool } from "../db/client";
import { safeQuoteSseConsumer } from "../safequote/sse-consumer";
import { discoverTodaySales, reconcileRecentSales } from "./sync";

const KEY = Symbol.for("sales_arena.sync_scheduler");
type G = { [KEY]?: { timer: NodeJS.Timeout; fast: NodeJS.Timeout | null; off?: () => void } };

/** Seconds between fast discovery polls (today's sales). 0 turns it off; otherwise at least 10. */
export function discoverySeconds(env = process.env.SALES_ARENA_DISCOVERY_SECONDS): number {
  if (env === "0") return 0;
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? Math.min(300, Math.max(10, Math.round(n))) : 20;
}

/**
 * Server-side sales discovery (one per process; idempotent: hot reload / multiple imports are safe):
 *  - Safe Quote's live event stream (seconds), the primary path;
 *  - fast discovery of today's sales every SALES_ARENA_DISCOVERY_SECONDS (default 20), so a sale the
 *    live stream did not deliver waits seconds, not minutes;
 *  - full reconciliation of yesterday + today every SALES_ARENA_RECONCILE_MINUTES (default 5).
 * The polls never overlap each other (one at a time), and errors back off up to 5 minutes.
 */
export function startSalesSync(): void {
  const g = globalThis as unknown as G;
  if (g[KEY]) return;
  const pool = getDbPool();
  if (!pool) return;

  safeQuoteSseConsumer.start();

  const minutes = Math.max(1, Number(process.env.SALES_ARENA_RECONCILE_MINUTES) || 5);
  let running: null | "full" | "fast" = null;
  let retry: NodeJS.Timeout | null = null;
  const run = async () => {
    if (running === "full") return; // never overlap
    if (running) {
      // A fast discovery poll is finishing (about a second): run right after it, once.
      retry ??= setTimeout(() => {
        retry = null;
        void run();
      }, 5000);
      return;
    }
    running = "full";
    try {
      const r = await reconcileRecentSales(pool);
      if (r.inserted || r.errors.length) {
        console.info(`[sales-sync] reconciliation: fetched ${r.fetched}, stored ${r.inserted}, duplicates ${r.duplicates}, errors ${r.errors.length}`);
      }
    } catch (err) {
      console.error("[sales-sync] reconciliation failed:", err instanceof Error ? err.message : err);
    } finally {
      running = null;
    }
  };
  setTimeout(run, 30_000); // restart recovery

  const fastSec = discoverySeconds();
  let failures = 0;
  const state: { timer: NodeJS.Timeout; fast: NodeJS.Timeout | null; off?: () => void } = { timer: setInterval(run, minutes * 60_000), fast: null };
  // After upstream case activity, check more often for a short while (Safe Quote's validated list can lag
  // its event by a few seconds): every BURST_STEP_MS until BURST_MS after the latest activity.
  const BURST_MS = 30_000;
  const BURST_STEP_MS = 5_000;
  let burstUntil = 0;
  let lastFastAt = 0;
  const scheduleFast = (inMs?: number) => {
    if (state.fast) clearTimeout(state.fast);
    const backoff = Math.min(300_000, fastSec * 1000 * 2 ** Math.min(failures, 5));
    const next = inMs ?? (Date.now() < burstUntil && !failures ? BURST_STEP_MS : backoff + Math.round(Math.random() * 1000));
    state.fast = setTimeout(fast, Math.max(0, next));
  };
  const fast = async () => {
    state.fast = null;
    if (running) return scheduleFast(3000); // the full reconciliation covers today too
    running = "fast";
    lastFastAt = Date.now();
    try {
      const r = await discoverTodaySales(pool);
      failures = r.errors.length && !r.fetched ? failures + 1 : 0;
      if (r.inserted) burstUntil = 0; // found it
      if (r.inserted) console.info(`[sales-sync] fast discovery stored ${r.inserted} sale(s) the live stream had not delivered`);
      if (failures === 1) console.warn(`[sales-sync] fast discovery failed, backing off: ${r.errors[0]?.slice(0, 200)}`);
    } catch (err) {
      failures++;
      if (failures === 1) console.warn("[sales-sync] fast discovery failed, backing off:", err instanceof Error ? err.message : err);
    } finally {
      running = null;
      scheduleFast();
    }
  };
  if (fastSec > 0) state.fast = setTimeout(fast, 45_000); // after the restart recovery run
  // Upstream says something happened to a case: check the validated list within ~2 s (at most one check per
  // 3 s, never overlapping), then every 5 s for 30 s. Works whatever the upstream event is called.
  state.off = safeQuoteSseConsumer.onCaseActivity(() => {
    if (fastSec <= 0) return;
    burstUntil = Date.now() + BURST_MS;
    if (running === "fast") return; // its completion schedules the burst
    if (failures) return; // Safe Quote is failing / rate-limiting: never cut the backoff short
    scheduleFast(Math.max(2000, lastFastAt + 3000 - Date.now()));
  });
  g[KEY] = state;
}

/** Stops everything startSalesSync started (tests; a clean shutdown). */
export function stopSalesSync(): void {
  const g = globalThis as unknown as G;
  const st = g[KEY];
  if (!st) return;
  clearInterval(st.timer);
  if (st.fast) clearTimeout(st.fast);
  st.off?.();
  safeQuoteSseConsumer.stop();
  delete g[KEY];
}
