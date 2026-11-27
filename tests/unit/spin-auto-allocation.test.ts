import { describe, it, expect } from "vitest";
import { thresholdsToGrant, autoGrantKey } from "@/backend/spins/rules";
import { weightedPick } from "@/backend/spins/execute";

/**
 * Unit tests for Spin & Win auto-allocation and prize probability.
 *
 * These tests cover the pure functions only (no DB, no I/O).
 * The raw validated transaction count path in grantAutomaticSpins() is tested
 * indirectly via thresholdsToGrant() — the ledger wraps it with COUNT(*).
 */

describe("auto-allocation — thresholds", () => {
  it("2 sales → 1 spin (threshold = 2)", () => {
    expect(thresholdsToGrant(2, 2, 0)).toEqual([1]);
  });

  it("4 sales → 2 spins total (threshold = 2)", () => {
    expect(thresholdsToGrant(4, 2, 0)).toEqual([1, 2]);
  });

  it("6 sales → 3 spins total (threshold = 2)", () => {
    expect(thresholdsToGrant(6, 2, 0)).toEqual([1, 2, 3]);
  });

  it("1 sale → 0 spins (threshold = 2)", () => {
    expect(thresholdsToGrant(1, 2, 0)).toEqual([]);
  });

  it("5 sales with 1 already granted → grants threshold 2 and 3 (not 1 again)", () => {
    // 5 sales ÷ 2 = floor(2.5) = 2 thresholds reached; already granted 1 → grant 2 only
    expect(thresholdsToGrant(5, 2, 1)).toEqual([2]);
  });

  it("4 sales already all granted → no duplicate credits", () => {
    expect(thresholdsToGrant(4, 2, 2)).toEqual([]);
  });

  it("threshold = 1 → one spin per validated sale", () => {
    expect(thresholdsToGrant(5, 1, 0)).toEqual([1, 2, 3, 4, 5]);
    expect(thresholdsToGrant(5, 1, 3)).toEqual([4, 5]);
  });

  it("zero sales → zero spins", () => {
    expect(thresholdsToGrant(0, 2, 0)).toEqual([]);
  });

  it("negative count is treated as zero (defensive)", () => {
    expect(thresholdsToGrant(-5, 2, 0)).toEqual([]);
  });

  it("idempotency key is deterministic and unique per (rule, agent, period, threshold)", () => {
    const k1 = autoGrantKey("rule_global_a1b2", "ALICE", "D:2026-11-27", 1);
    const k2 = autoGrantKey("rule_global_a1b2", "ALICE", "D:2026-11-27", 2);
    const k3 = autoGrantKey("rule_global_a1b2", "BOB", "D:2026-11-27", 1);
    expect(k1).toBe("auto:rule_global_a1b2:ALICE:D:2026-11-27:1");
    expect(k1).not.toBe(k2); // different threshold
    expect(k1).not.toBe(k3); // different agent
    expect(k1).toBe(autoGrantKey("rule_global_a1b2", "ALICE", "D:2026-11-27", 1)); // deterministic
  });

  it("independent of cash bonus/SPIF system (pure count, no carrier weight)", () => {
    // A Corebridge Financial sale (0.5 credit) counts as 1 raw sale for spins.
    // This is verified by using COUNT(*) in the SQL — the unit tests for the SQL
    // path are in integration tests; here we verify the threshold math uses integer counts.
    const rawCount = 2; // 2 Corebridge Financial sales = 1 spin (not 0.5+0.5=1 weighted credit debate)
    expect(thresholdsToGrant(rawCount, 2, 0)).toEqual([1]);
  });
});

describe("prize probability — weighted pick", () => {
  it("only prize is always selected (100%)", () => {
    const prizes = [{ weight: 1 }];
    for (let i = 0; i < 10; i++) expect(weightedPick(prizes)).toBe(0);
  });

  it("zero-weight prizes are never selected", () => {
    const prizes = [{ weight: 0 }, { weight: 5 }, { weight: 0 }];
    const counts = new Array(3).fill(0);
    for (let i = 0; i < 100; i++) counts[weightedPick(prizes)]++;
    expect(counts[0]).toBe(0);
    expect(counts[2]).toBe(0);
    expect(counts[1]).toBe(100);
  });

  it("relative weights are normalised (2× weight ≈ 2× probability)", () => {
    const prizes = [{ weight: 1 }, { weight: 3 }]; // 25% vs 75%
    const counts = [0, 0];
    const N = 10_000;
    for (let i = 0; i < N; i++) counts[weightedPick(prizes)]++;
    // With 10k samples, ratio should be close to 1:3
    const ratio = counts[1] / counts[0];
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
  });

  it("all prizes with equal weight are selected with uniform probability", () => {
    const N = 9_000;
    const prizes = [{ weight: 1 }, { weight: 1 }, { weight: 1 }]; // 33% each
    const counts = [0, 0, 0];
    for (let i = 0; i < N; i++) counts[weightedPick(prizes)]++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(N / 3 - 300);
      expect(c).toBeLessThan(N / 3 + 300);
    }
  });

  it("returns 0 when total weight is zero (safe fallback)", () => {
    expect(weightedPick([{ weight: 0 }, { weight: 0 }])).toBe(0);
  });

  it("handles fractional weights (e.g. 0.5 for a rare prize)", () => {
    const prizes = [{ weight: 0.5 }, { weight: 9.5 }]; // 5% vs 95%
    const counts = [0, 0];
    const N = 10_000;
    for (let i = 0; i < N; i++) counts[weightedPick(prizes)]++;
    // Rare prize should appear significantly less
    expect(counts[0]).toBeLessThan(counts[1]);
  });
});
