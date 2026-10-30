/** Shared (client + server) target maths. A null or 0 target means "not set". */

export type TargetPeriod = "day" | "week" | "month";
export const TARGET_PERIODS: TargetPeriod[] = ["day", "week", "month"];

export interface TargetProgress {
  target: number | null;
  completed: number;
  /** MAX(target − completed, 0); null when no target is set. */
  remaining: number | null;
  /** completed / target × 100, NOT capped at 100; null when no target is set. */
  percent: number | null;
}

export function targetProgress(completed: number, target: number | null | undefined): TargetProgress {
  const done = Math.max(0, Math.floor(Number(completed) || 0));
  const t = typeof target === "number" && Number.isFinite(target) && target > 0 ? Math.floor(target) : null;
  if (t === null) return { target: null, completed: done, remaining: null, percent: null };
  return { target: t, completed: done, remaining: Math.max(t - done, 0), percent: (done / t) * 100 };
}

export function formatPercent(p: number | null): string {
  if (p === null) return "—";
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;
}

export const PERIOD_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidPeriodKey(key: unknown): key is string {
  if (typeof key !== "string" || !PERIOD_KEY_RE.test(key)) return false;
  const d = new Date(`${key}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key;
}

const utc = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const keyOf = (d: Date) => d.toISOString().slice(0, 10);

/** First business date of the day/week/month that contains `dateKey` (YYYY-MM-DD). */
export function periodStartFor(period: TargetPeriod, dateKey: string, weekStartDay = 1): string {
  if (period === "day") return dateKey;
  const d = utc(dateKey);
  if (period === "month") return keyOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  const offset = (d.getUTCDay() - (((weekStartDay % 7) + 7) % 7) + 7) % 7;
  return keyOf(new Date(d.getTime() - offset * 86_400_000));
}

/** Last business date of that period. */
export function periodEndFor(period: TargetPeriod, dateKey: string, weekStartDay = 1): string {
  const start = utc(periodStartFor(period, dateKey, weekStartDay));
  if (period === "day") return keyOf(start);
  if (period === "week") return keyOf(new Date(start.getTime() + 6 * 86_400_000));
  return keyOf(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)));
}

/** Every date from `from` to `to` inclusive (max 62). */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = utc(from).getTime(), end = utc(to).getTime(); t <= end && out.length < 62; t += 86_400_000) out.push(keyOf(new Date(t)));
  return out;
}
