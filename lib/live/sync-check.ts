/**
 * Client side of the background sync check (/api/arena/sync): fingerprints → what to re-fetch, the
 * server clock offset (for delivery timing), and the safe notification-recovery rule.
 */

export interface SyncFingerprints {
  sales: string;
  awards: string;
  programs: string;
  config: number;
  screen: number;
  display: number;
  catalog: string;
  teams: string;
}
export interface RecentSale {
  caseId: string;
  userCode: string;
  closerName: string;
  validatedAt: string;
  firstSeenAt: string;
  source: string;
}
export interface SyncSnapshot {
  serverTime: string;
  fp: SyncFingerprints;
  recentSales: RecentSale[];
  recoveryWindowSec: number;
}

export type Dataset = keyof SyncFingerprints;

/** Datasets whose fingerprint changed (everything on the first check). */
export function changedDatasets(prev: SyncFingerprints | null, next: SyncFingerprints): Set<Dataset> {
  const keys = Object.keys(next) as Dataset[];
  if (!prev) return new Set(keys);
  return new Set(keys.filter((k) => prev[k] !== next[k]));
}

/**
 * Sales a display should still announce because its live stream missed them. Safe by construction:
 *  - only sales STORED after this display opened (server clock), so a refresh never replays anything;
 *  - only within the server's recovery window, so a reconnect never replays history;
 *  - never one this display already handled (live event or an earlier check);
 * oldest first, at most `max`.
 */
export function missedSales(
  recent: RecentSale[],
  opts: { seen: (caseId: string) => boolean; openedAtServerMs: number; nowServerMs: number; windowMs: number; max?: number },
): RecentSale[] {
  return recent
    .filter((s) => {
      const stored = new Date(s.firstSeenAt).getTime();
      return s.caseId && s.source !== "backfill" && Number.isFinite(stored) && stored > opts.openedAtServerMs && opts.nowServerMs - stored <= opts.windowMs && !opts.seen(s.caseId);
    })
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt))
    .slice(0, opts.max ?? 5);
}

// ── Server clock offset (server − browser), from the sync round trips. Smallest-RTT sample wins. ──
let offsetMs = 0;
let bestRtt = Infinity;
let measuredAt = 0;
export const serverOffsetMs = () => offsetMs;
/** Browser time → server time (ISO), for delivery reports. */
export const toServerTime = (localMs: number) => new Date(localMs + offsetMs).toISOString();
export function noteClockSample(sentMs: number, recvMs: number, serverIso: string) {
  const server = new Date(serverIso).getTime();
  const rtt = recvMs - sentMs;
  if (!Number.isFinite(server) || rtt < 0) return;
  // Re-measure every 10 minutes even if the RTT is worse (clocks drift, networks change).
  if (rtt <= bestRtt || recvMs - measuredAt > 600_000) {
    bestRtt = rtt;
    measuredAt = recvMs;
    offsetMs = server - (sentMs + rtt / 2);
  }
}

export async function fetchSyncSnapshot(signal: AbortSignal): Promise<SyncSnapshot> {
  const sent = Date.now();
  const res = await fetch("/api/arena/sync", { cache: "no-store", signal });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok || !j.fp) throw new Error(j?.error || `Sync check failed (HTTP ${res.status})`);
  noteClockSample(sent, Date.now(), j.serverTime);
  return { serverTime: j.serverTime, fp: j.fp, recentSales: Array.isArray(j.recentSales) ? j.recentSales : [], recoveryWindowSec: Number(j.recoveryWindowSec) || 600 };
}

/** Test hook. */
export function __resetClock() {
  offsetMs = 0;
  bestRtt = Infinity;
  measuredAt = 0;
}
