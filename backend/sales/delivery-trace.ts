/**
 * Live delivery trace (in memory, bounded; nothing is written to PostgreSQL).
 *
 * The server stamps each genuine sale / award when it is broadcast; Live Arena displays then report when
 * they received it and when its popup was on screen. Only keys broadcast by this process in the last
 * TRACE_WINDOW_MS are accepted, every set is capped, and display ids are opaque random strings. With
 * several app processes a display's report lands on the process that received it (production runs one).
 *
 * Browser times arrive already corrected to server time (the display measures its clock offset on every
 * background sync), so "broadcast → browser" is comparable across machines to within the request RTT / 2.
 */

export type TraceKind = "sale" | "award";
export type Via = "sse" | "sync";

interface DisplayReport {
  receivedAt: number | null;
  shownAt: number | null;
  via: Via;
}
export interface TraceEntry {
  kind: TraceKind;
  key: string;
  source: string;
  validatedAt: number | null;
  firstSeenAt: number | null;
  storedAt: number | null;
  broadcastAt: number;
  displays: Map<string, DisplayReport>;
}

const KEY = Symbol.for("sales_arena.delivery_trace");
const g = globalThis as unknown as { [KEY]?: Map<string, TraceEntry> };
const traces: Map<string, TraceEntry> = (g[KEY] ??= new Map());
const MAX_TRACES = 300;
const MAX_DISPLAYS = 100;
/** Reports are accepted this long after the broadcast (a popup can wait behind others or a spin). */
export const TRACE_WINDOW_MS = 30 * 60_000;
const DISPLAY_RE = /^[a-z0-9-]{8,64}$/;

const id = (kind: TraceKind, key: string) => `${kind}:${key}`;
const t = (v: string | null | undefined) => {
  const n = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(n) ? n : null;
};

export function traceBroadcast(kind: TraceKind, key: string, s: { source: string; validatedAt?: string | null; firstSeenAt?: string | null; storedAt?: string | null; broadcastAt: string }) {
  if (!key || s.source === "backfill") return;
  const k = id(kind, key);
  if (traces.has(k)) return;
  traces.set(k, { kind, key, source: s.source, validatedAt: t(s.validatedAt), firstSeenAt: t(s.firstSeenAt), storedAt: t(s.storedAt), broadcastAt: t(s.broadcastAt) ?? Date.now(), displays: new Map() });
  while (traces.size > MAX_TRACES) traces.delete(traces.keys().next().value as string);
}

export interface DisplayReportInput {
  kind: unknown;
  key: unknown;
  receivedAt?: unknown;
  shownAt?: unknown;
  via?: unknown;
}

/** Records one display's report. Returns false for anything not traced recently or malformed. */
export function recordDisplayReport(display: string, r: DisplayReportInput, now = Date.now()): boolean {
  if (!DISPLAY_RE.test(display) || (r.kind !== "sale" && r.kind !== "award") || typeof r.key !== "string" || r.key.length > 160) return false;
  const e = traces.get(id(r.kind, r.key));
  if (!e || now - e.broadcastAt > TRACE_WINDOW_MS) return false;
  const time = (v: unknown) => {
    const n = typeof v === "string" ? new Date(v).getTime() : NaN;
    // Plausible only: not before the sale was validated, not in the future (2 s clock tolerance).
    return Number.isFinite(n) && n <= now + 2000 && n >= (e.validatedAt ?? e.broadcastAt - TRACE_WINDOW_MS) ? n : null;
  };
  let d = e.displays.get(display);
  if (!d) {
    if (e.displays.size >= MAX_DISPLAYS) return false;
    d = { receivedAt: null, shownAt: null, via: r.via === "sync" ? "sync" : "sse" };
    e.displays.set(display, d);
  }
  d.receivedAt ??= time(r.receivedAt);
  d.shownAt ??= time(r.shownAt);
  return true;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const r = (s.length - 1) * p;
  const lo = Math.floor(r);
  return s[lo] + (s[Math.ceil(r)] - s[lo]) * (r - lo);
}
const sec = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);
const diff = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.max(0, b - a) : null);

export interface TraceRow {
  kind: TraceKind;
  key: string;
  source: string;
  validatedAt: string | null;
  storedAt: string | null;
  broadcastAt: string;
  /** Earliest display receipt / popup (server time), and how many displays reported. */
  firstReceivedAt: string | null;
  firstShownAt: string | null;
  displays: number;
  /** Displays that only got it from the background sync (their live stream missed it). */
  viaSync: number;
  stages: { discoverySec: number | null; backendSec: number | null; sseSec: number | null; frontendSec: number | null; totalSec: number | null };
}

export function traceRows(limit = 30): TraceRow[] {
  const iso = (n: number | null) => (n === null ? null : new Date(n).toISOString());
  return [...traces.values()]
    .reverse()
    .slice(0, limit)
    .map((e) => {
      const ds = [...e.displays.values()];
      const recv = ds.map((d) => d.receivedAt).filter((v): v is number => v !== null);
      const shown = ds.map((d) => d.shownAt).filter((v): v is number => v !== null);
      const firstRecv = recv.length ? Math.min(...recv) : null;
      const firstShown = shown.length ? Math.min(...shown) : null;
      // Per display, receipt → popup (same clock, exact); the median across displays.
      const fe = median(ds.filter((d) => d.receivedAt !== null && d.shownAt !== null).map((d) => (d.shownAt as number) - (d.receivedAt as number)));
      return {
        kind: e.kind,
        key: e.key,
        source: e.source,
        validatedAt: iso(e.validatedAt),
        storedAt: iso(e.storedAt),
        broadcastAt: new Date(e.broadcastAt).toISOString(),
        firstReceivedAt: iso(firstRecv),
        firstShownAt: iso(firstShown),
        displays: ds.length,
        viaSync: ds.filter((d) => d.via === "sync").length,
        stages: {
          discoverySec: sec(diff(e.validatedAt, e.firstSeenAt)),
          backendSec: sec(diff(e.firstSeenAt, e.broadcastAt)),
          sseSec: sec(diff(e.broadcastAt, firstRecv)),
          frontendSec: sec(fe === null ? null : Math.max(0, fe)),
          totalSec: sec(diff(e.validatedAt, firstShown ?? firstRecv)),
        },
      };
    });
}

export interface StageStats {
  stage: "discovery" | "backend" | "sse" | "frontend" | "total";
  samples: number;
  medianSec: number | null;
  p95Sec: number | null;
  maxSec: number | null;
}
/** Median / p95 / max per stage; numbers only once there are MIN_SAMPLES measured values. */
export const MIN_SAMPLES = 5;
export function stageStats(rows: TraceRow[]): StageStats[] {
  const keys = [
    ["discovery", "discoverySec"],
    ["backend", "backendSec"],
    ["sse", "sseSec"],
    ["frontend", "frontendSec"],
    ["total", "totalSec"],
  ] as const;
  return keys.map(([stage, k]) => {
    const xs = rows.map((r) => r.stages[k]).filter((v): v is number => v !== null);
    const ok = xs.length >= MIN_SAMPLES;
    const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
    return { stage, samples: xs.length, medianSec: ok ? r1(median(xs)) : null, p95Sec: ok ? r1(percentile(xs, 0.95)) : null, maxSec: ok ? r1(Math.max(...xs)) : null };
  });
}

/** Test hook. */
export function __resetTraces() {
  traces.clear();
}
