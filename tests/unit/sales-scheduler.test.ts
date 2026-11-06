import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server-side discovery scheduling (no network, no database): Safe Quote request rate, single flight,
 * backoff on errors / rate limits, and event-triggered bursts.
 */
type Report = { fetched: number; inserted: number; errors: string[] };
const h = vi.hoisted(() => ({
  fast: [] as number[],
  full: [] as number[],
  inFlight: 0,
  maxInFlight: 0,
  fastResult: (): Report => ({ fetched: 3, inserted: 0, errors: [] }),
  fastMs: 50,
  fullMs: 50,
  listeners: [] as Array<(i: { caseId: string; eventType: string }) => void>,
}));

vi.mock("@/database/client", () => ({ getDbPool: () => ({}) }));
vi.mock("@/backend/safequote/sse-consumer", () => ({
  safeQuoteSseConsumer: {
    start: () => {},
    stop: () => {},
    onCaseActivity: (fn: (i: { caseId: string; eventType: string }) => void) => {
      h.listeners.push(fn);
      return () => (h.listeners = h.listeners.filter((x) => x !== fn));
    },
  },
}));
vi.mock("@/backend/sales/sync", () => {
  const track = async <T,>(ms: number, v: T) => {
    h.inFlight++;
    h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
    await new Promise((r) => setTimeout(r, ms));
    h.inFlight--;
    return v;
  };
  return {
    discoverTodaySales: async () => {
      h.fast.push(Date.now());
      return track(h.fastMs, h.fastResult());
    },
    reconcileRecentSales: async () => {
      h.full.push(Date.now());
      return track(h.fullMs, { fetched: 5, inserted: 0, duplicates: 5, errors: [] });
    },
  };
});

import { startSalesSync, stopSalesSync } from "@/backend/sales/scheduler";

const emit = () => h.listeners.forEach((fn) => fn({ caseId: "C-1", eventType: "case.updated" }));
const t0 = () => Date.now();

describe("server discovery scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
    h.fast = [];
    h.full = [];
    h.inFlight = 0;
    h.maxInFlight = 0;
    h.fastMs = 50;
    h.fullMs = 50;
    h.fastResult = () => ({ fetched: 3, inserted: 0, errors: [] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    stopSalesSync();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("idle: about 3 fast checks a minute plus the 5-minute full check, never two at once", async () => {
    startSalesSync();
    const start = t0();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const fastPerMin = h.fast.filter((t) => t - start > 60_000).length / 9;
    expect(fastPerMin).toBeGreaterThanOrEqual(2.5);
    expect(fastPerMin).toBeLessThanOrEqual(3.1); // every 20 s + up to 1 s jitter
    expect(h.full.length).toBe(3); // restart recovery (30 s) + every 5 min
    expect(h.maxInFlight).toBe(1); // single flight across both polls
  });

  it("a slow full reconciliation never overlaps a fast check (the fast one waits)", async () => {
    h.fullMs = 25_000; // slow upstream
    startSalesSync();
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(h.maxInFlight).toBe(1);
    expect(h.fast.length).toBeGreaterThan(0);
  });

  it("errors / rate limits back off exponentially up to 5 minutes, then recover", async () => {
    h.fastResult = () => ({ fetched: 0, inserted: 0, errors: ["Safe Quote upstream returned HTTP 429: Too Many Requests"] });
    startSalesSync();
    await vi.advanceTimersByTimeAsync(45_100); // first fast check fails
    const failingFrom = h.fast.length;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const gaps = h.fast.slice(failingFrom - 1).map((t, i, a) => (i ? t - a[i - 1] : 0)).slice(1);
    // 40 s, 80 s, 160 s, then capped at 300 s (+ jitter and up to 50 ms run time).
    expect(gaps[0]).toBeGreaterThanOrEqual(40_000);
    expect(gaps[1]).toBeGreaterThanOrEqual(80_000);
    expect(gaps[2]).toBeGreaterThanOrEqual(160_000);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(301_100);
    expect(h.fast.length - failingFrom).toBeLessThanOrEqual(10); // ≈ 10 requests in 30 failing minutes

    // Upstream events while rate-limited never cut the backoff short.
    const before = h.fast.length;
    for (let i = 0; i < 20; i++) {
      emit();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(h.fast.length - before).toBeLessThanOrEqual(1);

    h.fastResult = () => ({ fetched: 3, inserted: 0, errors: [] }); // Safe Quote is back
    await vi.advanceTimersByTimeAsync(301_000);
    const recovered = h.fast.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fast.length - recovered).toBeGreaterThanOrEqual(2); // back to every 20 s
  });

  it("an upstream case event checks within ~2 s, then every 5 s for 30 s, then back to every 20 s", async () => {
    startSalesSync();
    await vi.advanceTimersByTimeAsync(50_000); // past the first fast check
    const n0 = h.fast.length;
    const at = t0();
    emit();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(h.fast.length).toBe(n0 + 1); // ~2 s after the event
    expect(h.fast[n0] - at).toBeLessThanOrEqual(2_100);
    await vi.advanceTimersByTimeAsync(30_000);
    const burst = h.fast.slice(n0).filter((t) => t - at <= 32_100).length;
    expect(burst).toBeGreaterThanOrEqual(6);
    expect(burst).toBeLessThanOrEqual(8); // at most one per ~5 s
    const n1 = h.fast.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fast.length - n1).toBeLessThanOrEqual(3); // normal pace again

    // A storm of events never makes checks closer than ~3 s apart, never overlapping.
    const s0 = h.fast.length;
    for (let i = 0; i < 50; i++) {
      emit();
      await vi.advanceTimersByTimeAsync(200);
    }
    const storm = h.fast.slice(s0);
    for (let i = 1; i < storm.length; i++) expect(storm[i] - storm[i - 1]).toBeGreaterThanOrEqual(2_000);
    expect(h.maxInFlight).toBe(1);
  });

  it("SALES_ARENA_DISCOVERY_SECONDS=0 turns the fast checks and bursts off", async () => {
    process.env.SALES_ARENA_DISCOVERY_SECONDS = "0";
    try {
      startSalesSync();
      emit();
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      expect(h.fast).toEqual([]);
      expect(h.full.length).toBe(2);
    } finally {
      delete process.env.SALES_ARENA_DISCOVERY_SECONDS;
    }
  });
});
