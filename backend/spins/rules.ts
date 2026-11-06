/**
 * Pure spin-rule logic (no database), so it can be unit tested exactly.
 *
 * Model
 *  - A rule version says: every `salesPerSpin` eligible validated sales within one
 *    `period` (business timezone) grant `spinsPerThreshold` spins.
 *  - A version is effective from `effectiveFrom` until `supersededAt` (exclusive).
 *    Changing a rule creates a new version; it only counts sales validated at or
 *    after its own effective time, so a change never re-counts earlier sales and
 *    never repeats grants made under the previous version.
 *  - Grants are numbered per (rule version, agent, period): threshold 1, 2, 3 …
 *    Each number can be granted once (unique key in the database).
 */

export type RulePeriod = "daily" | "weekly" | "monthly" | "lifetime";
export type RuleScope = "global" | "team" | "campaign";

export interface SpinRuleVersion {
  id: string;
  scopeType: RuleScope;
  scopeId: string | null;
  salesPerSpin: number;
  spinsPerThreshold: number;
  period: RulePeriod;
  enabled: boolean;
  effectiveFrom: Date;
  supersededAt: Date | null;
}

export interface BusinessCalendar {
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekStartDay: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(at: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? "0";
  return { y: +g("year"), m: +g("month"), d: +g("day"), h: +g("hour"), min: +g("minute"), s: +g("second"), dow: WEEKDAYS.indexOf(g("weekday")) };
}

/** Offset of `tz` from UTC at instant `at`, in ms (e.g. New York in winter: -5h). */
function tzOffsetMs(at: Date, tz: string): number {
  const p = parts(at, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight on calendar day (y, m, d) in `tz`. DST-safe. */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  // Second pass corrects days where the offset changes (DST transitions).
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, "0");

export interface PeriodWindow {
  key: string;
  start: Date | null;
  end: Date | null;
}

/** The business period containing `at`: key and [start, end) in UTC. */
export function periodWindow(period: RulePeriod, at: Date, cal: BusinessCalendar): PeriodWindow {
  if (period === "lifetime") return { key: "ALL", start: null, end: null };
  const p = parts(at, cal.timezone);
  if (period === "daily") {
    const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    return {
      key: `D:${p.y}-${pad(p.m)}-${pad(p.d)}`,
      start: zonedMidnight(p.y, p.m, p.d, cal.timezone),
      end: zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), cal.timezone),
    };
  }
  if (period === "weekly") {
    const offset = (p.dow - (((cal.weekStartDay % 7) + 7) % 7) + 7) % 7;
    const s = new Date(Date.UTC(p.y, p.m - 1, p.d - offset));
    const e = new Date(Date.UTC(p.y, p.m - 1, p.d - offset + 7));
    return {
      key: `W:${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`,
      start: zonedMidnight(s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate(), cal.timezone),
      end: zonedMidnight(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate(), cal.timezone),
    };
  }
  const e = new Date(Date.UTC(p.y, p.m, 1));
  return {
    key: `M:${p.y}-${pad(p.m)}`,
    start: zonedMidnight(p.y, p.m, 1, cal.timezone),
    end: zonedMidnight(e.getUTCFullYear(), e.getUTCMonth() + 1, 1, cal.timezone),
  };
}

export function isEffectiveAt(rule: SpinRuleVersion, at: Date): boolean {
  return rule.effectiveFrom.getTime() <= at.getTime() && (!rule.supersededAt || at.getTime() < rule.supersededAt.getTime());
}

/** Most specific rule version effective at `at`: team, then campaign, then global. */
export function selectRule(
  rules: SpinRuleVersion[],
  agent: { teamId: string | null; campaignId: string | null },
  at: Date,
): SpinRuleVersion | null {
  const live = rules.filter((r) => isEffectiveAt(r, at));
  return (
    (agent.teamId && live.find((r) => r.scopeType === "team" && r.scopeId === agent.teamId)) ||
    (agent.campaignId && live.find((r) => r.scopeType === "campaign" && r.scopeId === agent.campaignId)) ||
    live.find((r) => r.scopeType === "global") ||
    null
  );
}

/** Start of counting for a rule in a period: the later of the period start, the rule start and the activation cutoff. */
export function countingStart(rule: SpinRuleVersion, window: PeriodWindow, cutoff: Date): Date {
  const candidates = [rule.effectiveFrom.getTime(), cutoff.getTime()];
  if (window.start) candidates.push(window.start.getTime());
  return new Date(Math.max(...candidates));
}

/** Threshold numbers still to grant: (alreadyGranted, floor(count / salesPerSpin)]. */
export function thresholdsToGrant(eligibleCount: number, salesPerSpin: number, alreadyGranted: number): number[] {
  const reached = Math.floor(Math.max(0, eligibleCount) / Math.max(1, salesPerSpin));
  const out: number[] = [];
  for (let n = alreadyGranted + 1; n <= reached; n++) out.push(n);
  return out;
}

export function autoGrantKey(ruleId: string, userCode: string, periodKey: string, n: number): string {
  return `auto:${ruleId}:${userCode}:${periodKey}:${n}`;
}

/** Validates admin input for a new rule version; returns an error message or null. */
export function validateRuleInput(input: {
  scopeType: unknown;
  scopeId: unknown;
  salesPerSpin: unknown;
  spinsPerThreshold: unknown;
  period: unknown;
  enabled: unknown;
  effectiveFrom: unknown;
}, now: Date): string | null {
  if (!["global", "team", "campaign"].includes(String(input.scopeType))) return "Scope must be global, team or campaign.";
  if (input.scopeType !== "global" && (typeof input.scopeId !== "string" || !input.scopeId.trim())) return "Choose a team or campaign for this rule.";
  const sps = Number(input.salesPerSpin);
  if (!Number.isInteger(sps) || sps < 1 || sps > 1000) return "Validated sales per threshold must be a whole number from 1 to 1000.";
  const spt = Number(input.spinsPerThreshold);
  if (!Number.isInteger(spt) || spt < 1 || spt > 100) return "Spins per threshold must be a whole number from 1 to 100.";
  if (!["daily", "weekly", "monthly", "lifetime"].includes(String(input.period))) return "Period must be daily, weekly, monthly or lifetime.";
  if (typeof input.enabled !== "boolean") return "Enabled must be true or false.";
  const eff = new Date(String(input.effectiveFrom));
  if (Number.isNaN(eff.getTime())) return "Effective date/time is not valid.";
  // No back-dating: a rule can't reach back and re-count past sales.
  if (eff.getTime() < now.getTime() - 60_000) return "The effective time cannot be in the past.";
  return null;
}
