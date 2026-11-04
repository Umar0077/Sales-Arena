"use client";

import { displayId } from "./display-id";
import { toServerTime } from "./sync-check";

/**
 * Live delivery timeline, per genuine sale / award, measured in this browser from real timestamps:
 *
 *   validatedAt (Safe Quote) → firstSeenAt (server received) → storedAt (PostgreSQL commit)
 *   → broadcastAt (server SSE) → receivedAt (this browser) → shownAt (popup visible)
 *
 * Kept in memory only (last 50), readable as window.__arenaLatency for diagnostics. A total above
 * WARN_MS is logged once with the stage breakdown, so a slow popup always shows where the time went.
 * Server and browser clocks can differ slightly; the per-stage numbers on one machine are exact.
 */

export interface Timeline {
  kind: "sale" | "award";
  key: string;
  source?: string | null;
  validatedAt?: string | null;
  firstSeenAt?: string | null;
  storedAt?: string | null;
  broadcastAt?: string | null;
  receivedAt: string;
  shownAt?: string | null;
  /** How this display got it: the live stream, or the background sync after the stream missed it. */
  via?: "sse" | "sync";
}

const MAX = 50;
const WARN_MS = 60_000;
const items: Timeline[] = [];

const ms = (a?: string | null, b?: string | null) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : null);

/** Per-stage delays in ms (null when a stamp is missing). */
export function stages(t: Timeline) {
  return {
    sourceToServer: ms(t.validatedAt, t.firstSeenAt),
    serverToStored: ms(t.firstSeenAt, t.storedAt),
    storedToBroadcast: ms(t.storedAt, t.broadcastAt),
    broadcastToBrowser: ms(t.broadcastAt, t.receivedAt),
    browserToPopup: ms(t.receivedAt, t.shownAt),
    total: ms(t.validatedAt, t.shownAt ?? t.receivedAt),
  };
}

function expose() {
  if (typeof window !== "undefined") (window as unknown as { __arenaLatency: unknown }).__arenaLatency = items.map((t) => ({ ...t, stages: stages(t) }));
}

export function noteReceived(t: Omit<Timeline, "receivedAt">): void {
  if (!t.key || items.some((x) => x.kind === t.kind && x.key === t.key)) return;
  const now = Date.now();
  items.push({ ...t, via: t.via ?? "sse", receivedAt: new Date(now).toISOString() });
  if (items.length > MAX) items.splice(0, items.length - MAX);
  expose();
  report({ kind: t.kind, key: t.key, receivedAt: toServerTime(now), via: t.via ?? "sse" });
}

export function noteShown(kind: Timeline["kind"], key: string): void {
  const t = items.find((x) => x.kind === kind && x.key === key);
  if (!t || t.shownAt) return;
  const now = Date.now();
  t.shownAt = new Date(now).toISOString();
  expose();
  report({ kind, key, shownAt: toServerTime(now), via: t.via ?? "sse" });
  const s = stages(t);
  if (s.total !== null && s.total > WARN_MS) {
    const f = (v: number | null) => (v === null ? "?" : `${(v / 1000).toFixed(1)}s`);
    console.warn(
      `[live-latency] ${kind} ${key} (${t.source ?? "?"}) total ${f(s.total)}: source→server ${f(s.sourceToServer)}, stored ${f(s.serverToStored)}, ` +
        `broadcast ${f(s.storedToBroadcast)}, →browser ${f(s.broadcastToBrowser)}, →popup ${f(s.browserToPopup)}`,
    );
  }
}

export const latencyLog = () => items.map((t) => ({ ...t, stages: stages(t) }));

// ── Reports to the server (System Health → Live delivery). Batched, best effort, never retried. ──
type Report = { kind: Timeline["kind"]; key: string; receivedAt?: string; shownAt?: string; via: "sse" | "sync" };
const outbox: Report[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function report(r: Report) {
  if (typeof window === "undefined") return;
  outbox.push(r);
  if (outbox.length >= 20) return flush();
  flushTimer ??= setTimeout(flush, 1500);
}
function flush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const items = outbox.splice(0, 20);
  if (!items.length) return;
  void fetch("/api/arena/delivery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display: displayId(), items }), keepalive: true }).catch(() => {});
}
