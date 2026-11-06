/**
 * Business-time helpers. Daily, weekly and monthly boundaries are computed in the
 * configured business timezone with a configurable week start day, so a TV in
 * another timezone still agrees with the floor's calendar.
 */

export type RewardPeriod = "day" | "week" | "month";

export interface BusinessClock {
  /** IANA timezone, e.g. "Asia/Karachi". */
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekStartDay: number;
}

export interface PeriodInfo {
  period: RewardPeriod;
  /** Stable id for the period, e.g. "D:2026-10-29", "W:2026-10-26", "M:2026-10". Awards are keyed by it. */
  key: string;
  /** Number of full days before today that belong to the period (0 for "day"). */
  daysBack: number;
  /** First day of the period (YYYY-MM-DD). */
  startDay: string;
  /** Today in business time (YYYY-MM-DD). */
  today: string;
  label: string;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar date and weekday of `date` in `tz`. */
export function zonedParts(date: Date, tz: string): { y: number; m: number; d: number; dow: number } {
  const zone = isValidTimezone(tz) ? tz : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), dow: WEEKDAYS.indexOf(get("weekday")) };
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Shift a calendar date by whole days (timezone-free). */
function shiftDays(y: number, m: number, d: number, days: number): string {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function businessToday(clock: BusinessClock, now: Date = new Date()): string {
  const { y, m, d } = zonedParts(now, clock.timezone);
  return ymd(y, m, d);
}

export function periodInfo(period: RewardPeriod, clock: BusinessClock, now: Date = new Date()): PeriodInfo {
  const { y, m, d, dow } = zonedParts(now, clock.timezone);
  const today = ymd(y, m, d);
  if (period === "day") return { period, key: `D:${today}`, daysBack: 0, startDay: today, today, label: "Today" };
  if (period === "week") {
    const offset = (dow - (((clock.weekStartDay % 7) + 7) % 7) + 7) % 7;
    const startDay = shiftDays(y, m, d, -offset);
    return { period, key: `W:${startDay}`, daysBack: offset, startDay, today, label: "This Week" };
  }
  return { period, key: `M:${y}-${pad(m)}`, daysBack: d - 1, startDay: ymd(y, m, 1), today, label: "This Month" };
}

export interface PeriodDateRange {
  from: string;
  to: string;
  label: string;
  detailedLabel: string;
  periodKey: string;
}

export function getPeriodDateRange(period: RewardPeriod, clock: BusinessClock, now: Date = new Date()): PeriodDateRange {
  const info = periodInfo(period, clock, now);
  const startParts = info.startDay.split("-").map(Number);
  const todayParts = info.today.split("-").map(Number);
  const startObj = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));
  const todayObj = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]));
  const startFmt = startObj.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const todayFmt = todayObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  if (period === "day") {
    return {
      from: info.today,
      to: info.today,
      label: "Today",
      detailedLabel: `Today · ${todayFmt}`,
      periodKey: info.key,
    };
  }
  if (period === "week") {
    return {
      from: info.startDay,
      to: info.today,
      label: "This Week",
      detailedLabel: `This Week · ${startFmt} – ${todayFmt}`,
      periodKey: info.key,
    };
  }
  return {
    from: info.startDay,
    to: info.today,
    label: "This Month",
    detailedLabel: `This Month · ${startFmt} – ${todayFmt}`,
    periodKey: info.key,
  };
}

/** Is `today` inside an optional [start, end] campaign window (inclusive, YYYY-MM-DD)? */
export function withinDates(today: string, start: string | null | undefined, end: string | null | undefined): boolean {
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}
