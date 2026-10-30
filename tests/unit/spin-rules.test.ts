import { describe, it, expect } from "vitest";
import {
  periodWindow, zonedMidnight, selectRule, thresholdsToGrant, countingStart, validateRuleInput, autoGrantKey, type SpinRuleVersion,
} from "@/lib/server/spins/rules";
import { validateNewPassword, normalizeEmail } from "@/lib/server/auth/password";
import { csrfTokenFor, safeEqual } from "@/lib/server/auth/session";

const NY = { timezone: "America/New_York", weekStartDay: 1 };

describe("business periods (America/New_York)", () => {
  it("midnight is 04:00Z in summer and 05:00Z in winter", () => {
    expect(zonedMidnight(2026, 7, 15, NY.timezone).toISOString()).toBe("2026-07-15T04:00:00.000Z");
    expect(zonedMidnight(2026, 1, 15, NY.timezone).toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("a sale at 23:30 New York time belongs to that New York day, not the UTC day", () => {
    const at = new Date("2026-10-30T03:30:00Z"); // 23:30 EDT on Oct 29
    const w = periodWindow("daily", at, NY);
    expect(w.key).toBe("D:2026-10-29");
    expect(w.start!.toISOString()).toBe("2026-10-29T04:00:00.000Z");
    expect(w.end!.toISOString()).toBe("2026-10-30T04:00:00.000Z");
  });

  it("handles the DST change day (25-hour day on 1 Nov 2026)", () => {
    const w = periodWindow("daily", new Date("2026-11-01T15:00:00Z"), NY);
    expect(w.start!.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(w.end!.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("weekly uses the configured week start; monthly and lifetime keys", () => {
    const thu = new Date("2026-10-29T16:00:00Z");
    expect(periodWindow("weekly", thu, NY).key).toBe("W:2026-10-26");
    expect(periodWindow("weekly", thu, { ...NY, weekStartDay: 0 }).key).toBe("W:2026-10-25");
    expect(periodWindow("monthly", thu, NY)).toMatchObject({ key: "M:2026-10" });
    expect(periodWindow("monthly", thu, NY).end!.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(periodWindow("lifetime", thu, NY)).toEqual({ key: "ALL", start: null, end: null });
  });
});

const rule = (p: Partial<SpinRuleVersion>): SpinRuleVersion => ({
  id: "r", scopeType: "global", scopeId: null, salesPerSpin: 2, spinsPerThreshold: 1, period: "daily", enabled: true,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"), supersededAt: null, ...p,
});

describe("rule selection and thresholds", () => {
  it("prefers team, then campaign, then global — and respects effective windows", () => {
    const at = new Date("2026-06-01T12:00:00Z");
    const rules = [
      rule({ id: "g" }),
      rule({ id: "c", scopeType: "campaign", scopeId: "C1" }),
      rule({ id: "t", scopeType: "team", scopeId: "T1" }),
      rule({ id: "t-old", scopeType: "team", scopeId: "T2", supersededAt: new Date("2026-05-01T00:00:00Z") }),
      rule({ id: "future", scopeType: "team", scopeId: "T3", effectiveFrom: new Date("2026-07-01T00:00:00Z") }),
    ];
    expect(selectRule(rules, { teamId: "T1", campaignId: "C1" }, at)?.id).toBe("t");
    expect(selectRule(rules, { teamId: null, campaignId: "C1" }, at)?.id).toBe("c");
    expect(selectRule(rules, { teamId: "T2", campaignId: null }, at)?.id).toBe("g");
    expect(selectRule(rules, { teamId: "T3", campaignId: null }, at)?.id).toBe("g");
  });

  it("grants each threshold once", () => {
    expect(thresholdsToGrant(5, 2, 0)).toEqual([1, 2]);
    expect(thresholdsToGrant(5, 2, 2)).toEqual([]);
    expect(thresholdsToGrant(6, 2, 2)).toEqual([3]);
    expect(thresholdsToGrant(1, 1, 0)).toEqual([1]);
    expect(thresholdsToGrant(0, 3, 0)).toEqual([]);
    expect(autoGrantKey("r1", "A", "D:2026-10-29", 3)).toBe("auto:r1:A:D:2026-10-29:3");
  });

  it("counts from the latest of period start, rule start and activation cutoff", () => {
    const w = periodWindow("daily", new Date("2026-10-29T16:00:00Z"), NY);
    const r = rule({ effectiveFrom: new Date("2026-10-29T14:00:00Z") });
    expect(countingStart(r, w, new Date("2026-10-01T00:00:00Z")).toISOString()).toBe("2026-10-29T14:00:00.000Z");
    expect(countingStart(rule({}), w, new Date("2026-10-29T15:00:00Z")).toISOString()).toBe("2026-10-29T15:00:00.000Z");
    expect(countingStart(rule({}), w, new Date("2026-01-01T00:00:00Z")).toISOString()).toBe(w.start!.toISOString());
  });

  it("validates admin rule input and forbids back-dating", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const ok = { scopeType: "global", scopeId: null, salesPerSpin: 2, spinsPerThreshold: 1, period: "daily", enabled: true, effectiveFrom: now.toISOString() };
    expect(validateRuleInput(ok, now)).toBeNull();
    expect(validateRuleInput({ ...ok, salesPerSpin: 0 }, now)).toMatch(/from 1/);
    expect(validateRuleInput({ ...ok, salesPerSpin: 1.5 }, now)).toMatch(/whole number/);
    expect(validateRuleInput({ ...ok, period: "hourly" }, now)).toMatch(/Period/);
    expect(validateRuleInput({ ...ok, scopeType: "team", scopeId: "" }, now)).toMatch(/team or campaign/);
    expect(validateRuleInput({ ...ok, effectiveFrom: "2026-10-28T12:00:00Z" }, now)).toMatch(/past/);
  });
});

describe("auth helpers", () => {
  it("password policy", () => {
    expect(validateNewPassword("short")).toMatch(/12/);
    expect(validateNewPassword("aaaaaaaaaaaaaaa")).toMatch(/repeated/);
    expect(validateNewPassword("johnsmith-2026-xx", "johnsmith@corp.com")).toMatch(/email/);
    expect(validateNewPassword("Correct-Horse-Battery-9", "owner@example.com")).toBeNull();
  });
  it("email normalisation", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
  it("CSRF token is bound to the session token and compared in constant time", () => {
    expect(csrfTokenFor("abc")).toBe(csrfTokenFor("abc"));
    expect(csrfTokenFor("abc")).not.toBe(csrfTokenFor("abd"));
    expect(safeEqual("x", "x")).toBe(true);
    expect(safeEqual("x", "y")).toBe(false);
    expect(safeEqual("x", "xx")).toBe(false);
  });
});
