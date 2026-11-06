import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampInterval, createBackgroundSync } from "@/frontend/live/background-sync";
import { __resetClock, changedDatasets, missedSales, noteClockSample, serverOffsetMs, toServerTime, type RecentSale, type SyncFingerprints } from "@/frontend/live/sync-check";
import { __resetTraces, recordDisplayReport, stageStats, traceBroadcast, traceRows, TRACE_WINDOW_MS } from "@/backend/sales/delivery-trace";
import { discoverySeconds } from "@/backend/sales/scheduler";

describe("background sync scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const noJitter = () => 0.5; // rnd 0.5 → factor 1

  it("runs at the configured interval and reads the interval at each tick", async () => {
    let interval = 15_000;
    const run = vi.fn(async () => {});
    const bg = createBackgroundSync({ intervalMs: () => interval, run, random: noJitter, isVisible: () => true });
    bg.start();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(2);
    interval = 30_000; // an admin change applies from the next schedule
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(3); // already scheduled at 15 s
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(4);
    bg.stop();
  });

  it("never allows dangerously aggressive intervals", () => {
    expect(clampInterval(1000)).toBe(10_000);
    expect(clampInterval(10 * 60_000)).toBe(120_000);
    expect(clampInterval(NaN)).toBe(15_000);
  });

  it("never overlaps runs: a trigger during a run is coalesced", async () => {
    let release!: () => void;
    let active = 0;
    let maxActive = 0;
    const run = vi.fn(
      () =>
        new Promise<void>((r) => {
          active++;
          maxActive = Math.max(maxActive, active);
          release = () => {
            active--;
            r();
          };
        }),
    );
    const bg = createBackgroundSync({ intervalMs: () => 15_000, run, random: noJitter, isVisible: () => true });
    bg.start();
    const a = bg.trigger();
    const b = bg.trigger();
    expect(a).toBe(b);
    await vi.advanceTimersByTimeAsync(60_000); // the timer fires while the run is still in flight
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await a;
    expect(maxActive).toBe(1);
    bg.stop();
  });

  it("backs off after errors and recovers after a success", async () => {
    let fail = true;
    const run = vi.fn(async () => {
      if (fail) throw new Error("503");
    });
    const bg = createBackgroundSync({ intervalMs: () => 10_000, run, random: noJitter, isVisible: () => true, maxBackoffMs: 120_000 });
    bg.start();
    await vi.advanceTimersByTimeAsync(10_000); // 1st run fails
    expect(bg.state().failures).toBe(1);
    await vi.advanceTimersByTimeAsync(19_999); // next in 20 s
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(bg.state().failures).toBe(2);
    fail = false;
    await vi.advanceTimersByTimeAsync(40_000); // next in 40 s → succeeds
    expect(run).toHaveBeenCalledTimes(3);
    expect(bg.state().failures).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000); // back to the normal interval
    expect(run).toHaveBeenCalledTimes(4);
    bg.stop();
  });

  it("aborts the request in flight on stop and does not run while hidden", async () => {
    let visible = false;
    let signal: AbortSignal | null = null;
    const run = vi.fn((s: AbortSignal) => {
      signal = s;
      return new Promise<void>(() => {});
    });
    const bg = createBackgroundSync({ intervalMs: () => 10_000, run, random: noJitter, isVisible: () => visible });
    bg.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).not.toHaveBeenCalled(); // hidden tab: no requests
    visible = true;
    void bg.trigger();
    expect(signal!.aborted).toBe(false);
    bg.stop();
    expect(signal!.aborted).toBe(true);
  });

  it("spreads many displays with jitter (never in lock-step)", async () => {
    const delays = [0, 1].map((r) => {
      const run = vi.fn(async () => {});
      const bg = createBackgroundSync({ intervalMs: () => 15_000, run, random: () => r, isVisible: () => true, jitter: 0.1 });
      return { bg, run };
    });
    delays.forEach((d) => d.bg.start());
    await vi.advanceTimersByTimeAsync(13_500);
    expect(delays[0].run).toHaveBeenCalledTimes(1); // 15 s − 10 %
    expect(delays[1].run).toHaveBeenCalledTimes(0); // 15 s + 10 %
    delays.forEach((d) => d.bg.stop());
  });
});

describe("sync check: fingerprints and safe notification recovery", () => {
  const fp: SyncFingerprints = { sales: "3:3:a", awards: "1:1:b::2000", programs: "2:4:c", config: 7, screen: 1, display: 2, catalog: "x", teams: "3:t:30:m:30:d" };
  it("re-fetches only the datasets that changed", () => {
    expect(changedDatasets(fp, { ...fp })).toEqual(new Set());
    expect(changedDatasets(fp, { ...fp, sales: "4:4:d" })).toEqual(new Set(["sales"]));
    expect(changedDatasets(fp, { ...fp, awards: "2:1:e::5000", config: 8 })).toEqual(new Set(["awards", "config"]));
    expect(changedDatasets(null, fp).size).toBe(8);
  });

  const now = Date.parse("2026-11-04T18:00:00.000Z");
  const sale = (caseId: string, storedAgoSec: number, source = "reconciliation"): RecentSale => ({
    caseId,
    userCode: "CLS-1",
    closerName: "A",
    source,
    validatedAt: new Date(now - storedAgoSec * 1000 - 200_000).toISOString(),
    firstSeenAt: new Date(now - storedAgoSec * 1000).toISOString(),
  });
  const opts = (seen: string[] = [], openedAgoSec = 3600) => ({ seen: (k: string) => seen.includes(k), openedAtServerMs: now - openedAgoSec * 1000, nowServerMs: now, windowMs: 600_000 });

  it("announces a sale the live stream missed, once", () => {
    expect(missedSales([sale("A", 20)], opts()).map((s) => s.caseId)).toEqual(["A"]);
    expect(missedSales([sale("A", 20)], opts(["A"]))).toEqual([]); // already shown (live event or earlier check)
  });
  it("never replays a sale stored before this display opened (refresh)", () => {
    expect(missedSales([sale("A", 120)], opts([], 60))).toEqual([]);
  });
  it("never replays history after a long disconnection (bounded window)", () => {
    expect(missedSales([sale("OLD", 11 * 60), sale("NEW", 30)], opts([], 86_400)).map((s) => s.caseId)).toEqual(["NEW"]);
  });
  it("never announces backfill imports; oldest first; capped", () => {
    expect(missedSales([sale("B", 10, "backfill")], opts())).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => sale(`S${i}`, 100 - i));
    const out = missedSales(many, opts());
    expect(out).toHaveLength(5);
    expect(out[0].caseId).toBe("S0");
  });

  it("measures the server clock offset from the lowest-latency round trip", () => {
    __resetClock();
    noteClockSample(1000, 1400, new Date(6200).toISOString()); // rtt 400 → offset 5000
    expect(serverOffsetMs()).toBe(5000);
    noteClockSample(2000, 2100, new Date(7050).toISOString()); // rtt 100 (better) → offset 5000
    expect(serverOffsetMs()).toBe(5000);
    noteClockSample(3000, 3900, new Date(1).toISOString()); // worse rtt, ignored
    expect(serverOffsetMs()).toBe(5000);
    expect(toServerTime(0)).toBe(new Date(5000).toISOString());
    __resetClock();
  });
});

describe("delivery trace (System Health → Live delivery)", () => {
  beforeEach(() => __resetTraces());
  const base = Date.parse("2026-11-04T18:00:00.000Z");
  const at = (s: number) => new Date(base + s * 1000).toISOString();

  it("separates discovery, backend, live delivery and display queue time", () => {
    traceBroadcast("sale", "CASE-1", { source: "reconciliation", validatedAt: at(0), firstSeenAt: at(240), storedAt: at(240.2), broadcastAt: at(240.3) });
    expect(recordDisplayReport("d-display-one", { kind: "sale", key: "CASE-1", receivedAt: at(240.8), via: "sse" }, base + 241_000)).toBe(true);
    expect(recordDisplayReport("d-display-one", { kind: "sale", key: "CASE-1", shownAt: at(241.3) }, base + 242_000)).toBe(true);
    expect(recordDisplayReport("d-display-two", { kind: "sale", key: "CASE-1", receivedAt: at(250), shownAt: at(250.4), via: "sync" }, base + 251_000)).toBe(true);
    const [r] = traceRows();
    expect(r.stages).toEqual({ discoverySec: 240, backendSec: 0.3, sseSec: 0.5, frontendSec: 0.5, totalSec: 241.3 });
    expect(r.displays).toBe(2);
    expect(r.viaSync).toBe(1);
  });

  it("rejects unknown keys, junk display ids, implausible times and late reports", () => {
    traceBroadcast("award", "AW-1", { source: "sse", validatedAt: at(0), firstSeenAt: at(1), storedAt: at(1), broadcastAt: at(1) });
    expect(recordDisplayReport("d-display-one", { kind: "award", key: "nope", receivedAt: at(2) }, base + 3000)).toBe(false);
    expect(recordDisplayReport("<script>", { kind: "award", key: "AW-1", receivedAt: at(2) }, base + 3000)).toBe(false);
    expect(recordDisplayReport("d-display-one", { kind: "sale", key: "AW-1", receivedAt: at(2) }, base + 3000)).toBe(false);
    recordDisplayReport("d-display-one", { kind: "award", key: "AW-1", receivedAt: at(9999) }, base + 3000); // future: ignored
    expect(traceRows()[0].stages.sseSec).toBeNull();
    expect(recordDisplayReport("d-display-two", { kind: "award", key: "AW-1", receivedAt: at(2) }, base + 1000 + TRACE_WINDOW_MS + 1)).toBe(false);
    traceBroadcast("sale", "BF", { source: "backfill", broadcastAt: at(0) });
    expect(traceRows().some((r) => r.key === "BF")).toBe(false);
  });

  it("reports median / p95 / max only with enough samples", () => {
    for (let i = 0; i < 4; i++) traceBroadcast("sale", `C${i}`, { source: "sse", validatedAt: at(i * 100), firstSeenAt: at(i * 100 + 2), storedAt: at(i * 100 + 2), broadcastAt: at(i * 100 + 2) });
    const few = stageStats(traceRows()).find((s) => s.stage === "discovery")!;
    expect(few).toMatchObject({ samples: 4, medianSec: null, p95Sec: null, maxSec: null });
    traceBroadcast("sale", "C9", { source: "reconciliation", validatedAt: at(1000), firstSeenAt: at(1300), storedAt: at(1300), broadcastAt: at(1300) });
    const ok = stageStats(traceRows()).find((s) => s.stage === "discovery")!;
    expect(ok).toMatchObject({ samples: 5, medianSec: 2, maxSec: 300 });
    expect(ok.p95Sec).toBeGreaterThan(200);
    expect(stageStats(traceRows()).find((s) => s.stage === "frontend")!.samples).toBe(0); // never invented
  });
});

describe("server fast discovery interval", () => {
  it("defaults to 20 s, can be turned off, and is never below 10 s", () => {
    expect(discoverySeconds(undefined)).toBe(20);
    expect(discoverySeconds("0")).toBe(0);
    expect(discoverySeconds("3")).toBe(10);
    expect(discoverySeconds("45")).toBe(45);
    expect(discoverySeconds("9999")).toBe(300);
    expect(discoverySeconds("abc")).toBe(20);
  });
});
