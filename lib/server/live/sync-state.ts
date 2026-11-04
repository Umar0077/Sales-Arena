import type { Pool } from "pg";
import { loadWheelCatalog } from "../rewards/catalog";

/**
 * What every Live Arena display and Admin tab checks in the background (default every 15 s): small
 * fingerprints of the live datasets plus the sales stored in the last few minutes. A display re-fetches
 * a dataset only when its fingerprint changed, so idle screens cost a few bytes per check, and the
 * recent sales let a display that missed a live event still show its popup (once, never history).
 *
 * Read-only. One shared result for all callers for MEMO_MS, so many displays cost one set of queries.
 */

/** Sales stored within this window can still be announced by a display that missed the live event. */
export const RECOVERY_WINDOW_SEC = 10 * 60;
const MEMO_MS = 2000;
const MAX_RECENT = 20;

export interface RecentSale {
  caseId: string;
  userCode: string;
  closerName: string;
  validatedAt: string;
  firstSeenAt: string;
  source: string;
}
export interface SyncState {
  serverTime: string;
  fp: { sales: string; awards: string; programs: string; config: number; screen: number; display: number; catalog: string; teams: string };
  recentSales: RecentSale[];
  recoveryWindowSec: number;
}

const KEY = Symbol.for("sales_arena.sync_state");
type Memo = { at: number; p: Promise<SyncState> } | null;
const g = globalThis as unknown as { [KEY]?: { memo: Memo } };
const box = (g[KEY] ??= { memo: null });

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");

async function read(pool: Pool): Promise<SyncState> {
  const [sales, recent, awards, programs, settings, catalog, teams] = await Promise.all([
    // validated_at bounds the scan to the index (the monthly screen is the oldest live view).
    pool.query(
      `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE status = 'validated')::int v, MAX(first_seen_at) last
         FROM validated_sales WHERE source <> 'backfill' AND validated_at > NOW() - INTERVAL '40 days'`,
    ),
    pool.query(
      `SELECT case_id, user_code, closer_name, validated_at, first_seen_at, source
         FROM validated_sales
        WHERE source <> 'backfill' AND status = 'validated' AND validated_at > NOW() - INTERVAL '2 days'
          AND first_seen_at > NOW() - make_interval(secs => $1)
        ORDER BY first_seen_at DESC LIMIT $2`,
      [RECOVERY_WINDOW_SEC, MAX_RECENT],
    ),
    // Any created / upgraded (superseded) / status-changed / deleted award changes this.
    pool.query(
      `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE superseded_by IS NULL)::int eff, MAX(created_at) c, MAX(status_changed_at) s,
              COALESCE(SUM(amount), 0)::text amt FROM bonus_awards`,
    ),
    pool.query(`SELECT COUNT(*)::int n, MAX(updated_at) u, COALESCE(SUM(revision), 0)::int r FROM reward_programs`),
    pool.query(`SELECT key, value->>'revision' AS rev FROM admin_settings WHERE key IN ('arena.config', 'arena.screen.current', 'display.performance_mode')`),
    loadWheelCatalog(pool).then((c) => c.revision).catch(() => ""),
    // Teams Arena configuration: teams, memberships and designations (any add / edit / transfer / removal).
    pool
      .query(
        `SELECT (SELECT COUNT(*) FROM teams WHERE slug IS NOT NULL)::text || ':' || COALESCE((SELECT MAX(updated_at)::text FROM teams WHERE slug IS NOT NULL), '') || ':' ||
                (SELECT COUNT(*) FROM team_memberships)::text || ':' || COALESCE((SELECT MAX(updated_at)::text FROM team_memberships), '') || ':' ||
                (SELECT COUNT(*) FROM agent_designations)::text || ':' || COALESCE((SELECT MAX(id)::text FROM agent_designations), '') AS fp`,
      )
      .then((r) => String(r.rows[0]?.fp ?? ""))
      .catch(() => ""),
  ]);
  const rev = (k: string) => Number(settings.rows.find((r) => r.key === k)?.rev) || 0;
  const s = sales.rows[0] ?? {};
  const a = awards.rows[0] ?? {};
  const p = programs.rows[0] ?? {};
  return {
    serverTime: new Date().toISOString(),
    fp: {
      sales: `${s.n ?? 0}:${s.v ?? 0}:${iso(s.last)}`,
      awards: `${a.n ?? 0}:${a.eff ?? 0}:${iso(a.c)}:${iso(a.s)}:${a.amt ?? 0}`,
      programs: `${p.n ?? 0}:${p.r ?? 0}:${iso(p.u)}`,
      config: rev("arena.config"),
      screen: rev("arena.screen.current"),
      display: rev("display.performance_mode"),
      catalog,
      teams,
    },
    recentSales: recent.rows.map((r) => ({
      caseId: r.case_id,
      userCode: r.user_code,
      closerName: r.closer_name || r.user_code,
      validatedAt: iso(r.validated_at),
      firstSeenAt: iso(r.first_seen_at),
      source: r.source,
    })),
    recoveryWindowSec: RECOVERY_WINDOW_SEC,
  };
}

export function readSyncState(pool: Pool, now = Date.now()): Promise<SyncState> {
  const m = box.memo;
  if (m && now - m.at < MEMO_MS) return m.p;
  const p = read(pool);
  box.memo = { at: now, p };
  p.catch(() => {
    if (box.memo?.p === p) box.memo = null; // never keep a failure
  });
  return p;
}

/** Test hook. */
export function __resetSyncState() {
  box.memo = null;
}
