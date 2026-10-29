import { describe, it, expect } from "vitest";
import { evaluateAwards, awardId, formatReward } from "@/lib/rewards/engine";
import { periodInfo, withinDates } from "@/lib/time/business";
import { DEFAULT_PROGRAMS, sanitizeProgram, type BonusProgram, type BonusAward } from "@/store/rewards-store";
import { enqueueAnnouncement } from "@/store/bonus-flow-store";
import { resolveMode } from "@/store/arena-mode-store";
import type { Sale, SaleStatus, Agent } from "@/types";

const clock = { timezone: "UTC", weekStartDay: 1 };
// Thursday 29 Oct 2026, 12:00 UTC → week started Monday 26th (3 days back), month day 29.
const NOW = new Date("2026-10-29T12:00:00Z");
const agent = { id: "A", name: "Ali Khan", active: true, teamId: "t", campaignId: "c" } as Agent;

let n = 0;
const sale = (status: SaleStatus, id = `s${n++}`): Sale => ({
  id, agentId: "A", teamId: "t", campaignId: "c", status, product: "P", value: 1,
  createdAt: NOW.toISOString(), approvedAt: status === "approved" ? NOW.toISOString() : null, source: "demo-simulator",
});
const data = (sales: Sale[], history: number[] = []) => ({ agents: [agent], sales, history: { A: history }, historySubmitted: { A: history.map((v) => v + 1) } });
const prog = (kind: BonusProgram["kind"], patch: Partial<BonusProgram> = {}) => ({ ...DEFAULT_PROGRAMS.find((p) => p.kind === kind)!, ...patch });
const run = (sales: Sale[], programs: BonusProgram[], existing: BonusAward[] = [], history: number[] = [], allowed = () => true) =>
  evaluateAwards(data(sales, history), programs, existing, "A", { clock, allowed, now: NOW });

describe("business periods", () => {
  it("uses the configured week start and timezone", () => {
    expect(periodInfo("week", clock, NOW)).toMatchObject({ key: "W:2026-10-26", daysBack: 3 });
    expect(periodInfo("week", { ...clock, weekStartDay: 0 }, NOW)).toMatchObject({ key: "W:2026-10-25", daysBack: 4 });
    expect(periodInfo("month", clock, NOW)).toMatchObject({ key: "M:2026-10", daysBack: 28 });
    // 23:30 UTC on the 29th is already the 30th in Karachi (UTC+5).
    expect(periodInfo("day", { ...clock, timezone: "Asia/Karachi" }, new Date("2026-10-29T23:30:00Z")).key).toBe("D:2026-10-30");
  });
  it("respects campaign dates", () => {
    expect(withinDates("2026-10-29", "2026-10-01", "2026-10-31")).toBe(true);
    expect(withinDates("2026-10-29", "2026-11-01", null)).toBe(false);
    expect(withinDates("2026-10-29", null, "2026-10-28")).toBe(false);
  });
});

describe("daily bonus: 1 validated sale = Rs. 1,000", () => {
  const daily = prog("daily", { salesRequired: 1, amount: 1000, maxAwards: 10 });

  it("awards per validated sale only", () => {
    const awards = run([sale("approved"), sale("pending"), sale("rejected"), sale("duplicate")], [daily]);
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({ amount: 1000, validatedAtAward: 1, n: 1 });
    expect(formatReward(awards[0].amount, "", "Rs.")).toBe("Rs. 1,000");
  });

  it("pending leads never award", () => {
    expect(run([sale("pending"), sale("pending")], [daily])).toHaveLength(0);
  });

  it("re-evaluating the same sales never double-awards", () => {
    const sales = [sale("approved"), sale("approved")];
    const first = run(sales, [daily]);
    expect(first).toHaveLength(2);
    expect(run(sales, [daily], first)).toHaveLength(0);
    expect(first.map((a) => a.id)).toEqual([awardId(daily.id, "A", "D:2026-10-29", 1), awardId(daily.id, "A", "D:2026-10-29", 2)]);
  });

  it("respects the daily reward limit", () => {
    const capped = prog("daily", { salesRequired: 1, maxAwards: 3 });
    expect(run(Array.from({ length: 6 }, () => sale("approved")), [capped])).toHaveLength(3);
  });

  it("does nothing when disabled, outside its dates, or not allowed to run with others", () => {
    const s = [sale("approved")];
    expect(run(s, [{ ...daily, enabled: false }])).toHaveLength(0);
    expect(run(s, [{ ...daily, startDate: "2026-11-01" }])).toHaveLength(0);
    expect(run(s, [daily], [], [], () => false)).toHaveLength(0);
  });
});

describe("weekly and monthly milestones", () => {
  it("weekly: 10 validated this week (history + today) awards once", () => {
    const weekly = prog("weekly", { salesRequired: 10, amount: 5000, maxAwards: 1 });
    // 3 + 3 + 2 validated on the 3 earlier days this week, 2 today = 10 (the 9 is last week).
    const today = [sale("approved"), sale("approved"), sale("pending")];
    const awards = run(today, [weekly], [], [3, 3, 2, 9]);
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({ periodKey: "W:2026-10-26", validatedAtAward: 10, amount: 5000 });
    expect(run([...today, sale("approved"), sale("approved")], [weekly], awards, [3, 3, 2, 9])).toHaveLength(0);
  });

  it("monthly: below target gives nothing", () => {
    const monthly = prog("monthly", { salesRequired: 40 });
    expect(run([sale("approved")], [monthly], [], Array(28).fill(1))).toHaveLength(0); // 29 < 40
  });

  it("past awards stand when the target changes; new awards continue from them", () => {
    const weekly = prog("weekly", { salesRequired: 2, maxAwards: 5 });
    const sales = [sale("approved"), sale("approved")];
    const first = run(sales, [weekly]);
    expect(first).toHaveLength(1);
    // Admin raises the target: the existing award is untouched, nothing new yet.
    expect(run(sales, [{ ...weekly, salesRequired: 3 }], first)).toHaveLength(0);
  });

  it("programs are tracked independently", () => {
    const all = [prog("daily", { salesRequired: 1 }), prog("weekly", { salesRequired: 1 }), prog("monthly", { salesRequired: 1 })];
    const awards = run([sale("approved")], all);
    expect(awards.map((a) => a.kind).sort()).toEqual(["daily", "monthly", "weekly"]);
  });
});

describe("admin input and display", () => {
  it("sanitizes program values", () => {
    const p = sanitizeProgram({ ...DEFAULT_PROGRAMS[0], salesRequired: 0, amount: -5, maxAwards: 0, startDate: "2026-10-10", endDate: "2026-10-01" });
    expect(p).toMatchObject({ salesRequired: 1, amount: 0, maxAwards: 1, endDate: "2026-10-10" });
  });

  it("merges popups for the same agent and program", () => {
    const a = (id: string, programId = "prog_daily", agentId = "A") => ({ id, programId, agentId }) as BonusAward;
    let q = enqueueAnnouncement([], { key: "1", awards: [a("x")] });
    q = enqueueAnnouncement(q, { key: "2", awards: [a("y")] });
    q = enqueueAnnouncement(q, { key: "3", awards: [a("z", "prog_weekly")] });
    expect(q).toHaveLength(2);
    expect(q[0].awards.map((x) => x.id)).toEqual(["x", "y"]);
  });

  it("resolves the screen: picked, then default, then first enabled", () => {
    const modes = { daily: true, weekly: false, monthly: true, spin: true };
    expect(resolveMode("monthly", { arenaModes: modes, defaultArenaMode: "daily" })).toBe("monthly");
    expect(resolveMode("weekly", { arenaModes: modes, defaultArenaMode: "daily" })).toBe("daily");
    expect(resolveMode(null, { arenaModes: { ...modes, daily: false }, defaultArenaMode: "daily" })).toBe("monthly");
  });
});

describe("daily campaign switched on mid-day", () => {
  it("counts only sales validated after it was switched on", () => {
    const old = { ...sale("approved"), approvedAt: "2026-10-29T08:00:00.000Z" };
    const old2 = { ...sale("approved"), approvedAt: "2026-10-29T09:00:00.000Z" };
    const fresh = { ...sale("approved"), approvedAt: "2026-10-29T11:00:00.000Z" };
    const daily = prog("daily", { salesRequired: 1, activeSince: "2026-10-29T10:00:00.000Z" });
    const awards = run([old, old2, fresh], [daily]);
    expect(awards).toHaveLength(1);
    expect(awards[0].validatedAtAward).toBe(3); // popup still shows today's total
  });
});
