import { describe, expect, it } from "vitest";
import { targetProgress, formatPercent, periodStartFor, periodEndFor, datesBetween, isValidPeriodKey } from "@/lib/live/targets";
import { createLiveData } from "@/lib/mock-api/seed";

describe("target maths", () => {
  it("computes completed, remaining and uncapped percentage", () => {
    expect(targetProgress(30, 40)).toEqual({ target: 40, completed: 30, remaining: 10, percent: 75 });
    const over = targetProgress(50, 40);
    expect(over.remaining).toBe(0);
    expect(over.percent).toBe(125); // not capped at 100
  });

  it("treats an unset or zero target as 'not set' without dividing by zero", () => {
    for (const t of [null, undefined, 0, -5, Number.NaN]) {
      const p = targetProgress(12, t as number | null);
      expect(p).toEqual({ target: null, completed: 12, remaining: null, percent: null });
    }
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(125)).toBe("125%");
  });

  it("finds period start/end in business dates (Monday weeks, calendar months)", () => {
    expect(periodStartFor("day", "2026-10-30")).toBe("2026-10-30");
    expect(periodStartFor("week", "2026-10-30", 1)).toBe("2026-10-26"); // Fri → Mon
    expect(periodEndFor("week", "2026-10-30", 1)).toBe("2026-11-01");
    expect(periodStartFor("week", "2026-10-26", 1)).toBe("2026-10-26");
    expect(periodStartFor("month", "2026-02-17")).toBe("2026-02-01");
    expect(periodEndFor("month", "2028-02-10")).toBe("2028-02-29"); // leap year
    expect(datesBetween("2026-10-26", "2026-10-30")).toHaveLength(5);
  });

  it("validates period keys", () => {
    expect(isValidPeriodKey("2026-10-30")).toBe(true);
    expect(isValidPeriodKey("2026-02-30")).toBe(false);
    expect(isValidPeriodKey("30-10-2026")).toBe(false);
    expect(isValidPeriodKey(20261030)).toBe(false);
  });
});

describe("live-mode initial state", () => {
  it("contains no demo agents, teams, sales, spins or activity", () => {
    const d = createLiveData(new Date("2026-10-30T15:00:00Z"));
    expect(d.agents).toEqual([]);
    expect(d.teams).toEqual([]);
    expect(d.sales).toEqual([]);
    expect(d.spins).toEqual([]);
    expect(d.activity).toEqual([]);
    expect(d.bonusCredits).toEqual({});
    expect(d.history).toEqual({});
    expect(d.dataSourceMode).toBe("production");
    expect(d.lastSyncAt).toBeNull(); // nothing is "live" until verified data arrives
    expect(JSON.stringify(d)).not.toMatch(/Titans|Falcons|Phoenix|Vipers|Storm|Royals/);
  });
});
