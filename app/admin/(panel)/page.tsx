"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Send, Users, Target, TrendingUp, Flame, RefreshCw, AlertTriangle, Trophy, Clock } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { adminApi } from "@/components/admin/admin-api";
import { useSettingsStore } from "@/store/settings-store";
import { getPeriodDateRange, type PeriodDateRange } from "@/lib/time/business";
import { targetProgress, formatPercent, datesBetween, type TargetPeriod } from "@/lib/live/targets";
import type { CloserRow } from "@/features/sales/leads";
import type { Sale } from "@/types";
import { cn } from "@/lib/utils";

interface Summary {
  submitted: number;
  validated: number;
  activeClosers: number;
  closeRate: number;
  range: { from: string | null; to: string | null };
}
interface PeriodData {
  range: PeriodDateRange;
  summary: Summary;
  closers: CloserRow[];
  sales: Sale[];
  target: number | null;
  trend: Array<{ label: string; sales: number }>;
  trendNote: string | null;
  fetchedAt: string;
}

const TABS: Array<{ id: TargetPeriod; label: string }> = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
];
const WORD: Record<TargetPeriod, string> = { day: "today", week: "this week", month: "this month" };
const RECENT_LIMIT = 50;

async function getJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(j.error ?? j.message ?? `Request failed (${res.status})`);
  return j;
}

/** Runs async jobs with limited concurrency (keeps upstream load reasonable). */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const hourIn = (iso: string, timeZone: string) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date(iso)));

async function loadPeriod(period: TargetPeriod, timezone: string, weekStartDay: number, fresh: boolean): Promise<PeriodData> {
  const range = getPeriodDateRange(period, { timezone, weekStartDay });
  const q = `from=${range.from}&to=${range.to}${fresh ? "&fresh=true" : ""}`;
  const [summaryJ, closersJ, salesJ, targetsJ] = await Promise.all([
    getJson(`/api/arena/summary?${q}`),
    getJson(`/api/arena/closers?${q}`),
    getJson(`/api/arena/recent-sales?${q}`),
    adminApi<{ targets: Record<TargetPeriod, { target: number } | null> }>(`/api/admin/targets?${period}=${range.from}&limit=1`),
  ]);
  const sales: Sale[] = Array.isArray(salesJ.sales) ? salesJ.sales : [];
  const validatedSales = sales.filter((s) => s.status === "approved");

  let trend: PeriodData["trend"] = [];
  let trendNote: string | null = null;
  if (period === "day") {
    const counts = new Array(24).fill(0);
    for (const s of validatedSales) counts[hourIn(s.approvedAt ?? s.createdAt, timezone)]++;
    const now = hourIn(new Date().toISOString(), timezone);
    trend = counts.slice(0, now + 1).map((n, h) => ({ label: `${String(h).padStart(2, "0")}:00`, sales: n }));
    if (sales.length >= RECENT_LIMIT) trendNote = `Based on the ${RECENT_LIMIT} most recent sales Safe Quote returns; earlier sales today are not included in this chart.`;
  } else {
    // One date-filtered summary per day: exact daily validated counts (no 50-row cap).
    const days = datesBetween(range.from, range.to);
    const perDay = await pool(days, 6, async (d) => {
      try {
        const j = await getJson(`/api/arena/summary?from=${d}&to=${d}`);
        return Number(j.data?.validated ?? 0);
      } catch {
        return null;
      }
    });
    trend = days.map((d, i) => ({
      label: new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      sales: perDay[i] ?? 0,
    }));
    if (perDay.some((v) => v === null)) trendNote = "Some days could not be loaded from Safe Quote and show as 0.";
  }

  return {
    range,
    summary: summaryJ.data,
    closers: Array.isArray(closersJ.closers) ? closersJ.closers : [],
    sales: validatedSales,
    target: targetsJ.ok ? (targetsJ.data.targets[period]?.target ?? null) : null,
    trend,
    trendNote,
    fetchedAt: new Date().toISOString(),
  };
}

/** Admin Overview: real Safe Quote data per Daily / Weekly / Monthly period plus PostgreSQL targets. */
export default function AdminOverviewPage() {
  const timezone = useSettingsStore((s) => s.businessTimezone) || "America/New_York";
  const weekStartDay = useSettingsStore((s) => s.weekStartDay) ?? 1;
  const [period, setPeriod] = useState<TargetPeriod>("day");
  const [data, setData] = useState<Partial<Record<TargetPeriod, PeriodData>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (fresh = false) => {
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const d = await loadPeriod(period, timezone, weekStartDay, fresh);
        if (mine !== seq.current) return; // a newer request (other tab/period) won
        setData((prev) => ({ ...prev, [period]: d }));
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : "Safe Quote is unavailable.");
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [period, timezone, weekStartDay],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const d = data[period];
  const progress = targetProgress(d?.summary.validated ?? 0, d?.target ?? null);
  const top = useMemo(() => (d?.closers ?? []).slice(0, 8), [d]);

  const cards = d
    ? [
        { label: `Submitted ${WORD[period]}`, value: d.summary.submitted.toLocaleString(), icon: Send, tone: "text-white", testId: "ov-submitted" },
        { label: `Validated ${WORD[period]}`, value: d.summary.validated.toLocaleString(), icon: BadgeCheck, tone: "text-emerald-300", testId: "ov-validated" },
        { label: "Active closers", value: d.summary.activeClosers.toLocaleString(), icon: Users, tone: "text-white", testId: "ov-active" },
        { label: `${TABS.find((t) => t.id === period)!.label} target`, value: progress.target === null ? "Not set" : progress.target.toLocaleString(), icon: Target, tone: progress.target === null ? "text-text-muted" : "text-secondary", testId: "ov-target" },
        { label: "Completed", value: progress.completed.toLocaleString(), icon: TrendingUp, tone: "text-white", testId: "ov-completed" },
        { label: "Remaining", value: progress.remaining === null ? "—" : progress.remaining.toLocaleString(), icon: Flame, tone: "text-gold", testId: "ov-remaining" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-white">FE Sales Arena — Overview</h1>
          <p className="mt-1 text-sm text-text-muted" data-testid="ov-range">
            {d ? `${d.range.detailedLabel} · Live Safe Quote data · ${timezone}` : `Live Safe Quote data · ${timezone}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Reporting period" className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={period === t.id}
                onClick={() => setPeriod(t.id)}
                className={cn("rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors", period === t.id ? "bg-primary text-white shadow" : "text-text-muted hover:text-white")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => void load(true)}
            disabled={loading}
            aria-label="Refresh overview data"
            title="Refresh overview data"
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-text-muted transition-colors hover:text-secondary disabled:cursor-wait"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {d ? `Couldn't refresh: ${error}. Showing the last loaded data.` : `Live data is unavailable: ${error}`}
          </span>
          <button onClick={() => void load(true)} className="rounded-lg border border-rose-400/30 px-3 py-1 font-semibold hover:bg-rose-500/10">
            Retry
          </button>
        </div>
      )}

      {!d ? (
        !error && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" aria-busy="true" data-testid="ov-skeleton">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-[92px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
            ))}
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {cards.map((c) => (
              <div key={c.label} className="rounded-2xl border border-white/10 bg-[#0D1426]/90 p-4">
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
                  <span className="truncate">{c.label}</span>
                  <c.icon className="h-4 w-4 shrink-0 text-secondary" />
                </div>
                <div className={cn("font-heading text-2xl font-black tabular", c.tone)} data-testid={c.testId}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0D1426]/90 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-white">Target completion</span>
              <span className="font-heading font-bold text-secondary" data-testid="ov-percent">
                {formatPercent(progress.percent)}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-700" style={{ width: `${Math.min(100, progress.percent ?? 0)}%` }} />
            </div>
            {progress.target === null && (
              <p className="mt-2 text-xs text-text-muted">
                No target set for this period. <Link href="/admin/targets" className="text-secondary hover:underline">Set one in Target Management</Link>.
              </p>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
            <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 p-6">
              <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-4">
                <div>
                  <h3 className="font-heading text-base font-bold text-white">{period === "day" ? "Hourly sales performance" : period === "week" ? "Daily sales trend" : "Monthly performance trend"}</h3>
                  <p className="text-xs text-muted">Validated sales {period === "day" ? "per hour" : "per day"} ({timezone})</p>
                </div>
              </div>
              <div className="h-64 w-full">
                {d.trend.every((p) => p.sales === 0) ? (
                  <div className="grid h-full place-items-center text-sm text-text-muted">No validated sales {WORD[period]} yet.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    {period === "day" ? (
                      <AreaChart data={d.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="ovGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#7568FF" stopOpacity={0.6} />
                            <stop offset="95%" stopColor="#7568FF" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="label" stroke="#7483A0" fontSize={11} />
                        <YAxis stroke="#7483A0" fontSize={11} allowDecimals={false} />
                        <Tooltip contentStyle={{ backgroundColor: "#121C32", borderColor: "rgba(117,104,255,0.3)", borderRadius: 12, fontSize: 12 }} />
                        <Area type="monotone" dataKey="sales" name="Validated sales" stroke="#7568FF" strokeWidth={3} fill="url(#ovGrad)" />
                      </AreaChart>
                    ) : (
                      <BarChart data={d.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <XAxis dataKey="label" stroke="#7483A0" fontSize={11} />
                        <YAxis stroke="#7483A0" fontSize={11} allowDecimals={false} />
                        <Tooltip contentStyle={{ backgroundColor: "#121C32", borderColor: "rgba(117,104,255,0.3)", borderRadius: 12, fontSize: 12 }} />
                        <Bar dataKey="sales" name="Validated sales" fill="#27D5FF" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                )}
              </div>
              {d.trendNote && <p className="mt-3 text-xs text-text-muted">{d.trendNote}</p>}
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 p-6">
              <h3 className="mb-4 flex items-center gap-2 font-heading text-base font-bold text-white">
                <Trophy className="h-4 w-4 text-gold" /> Top closers {WORD[period]}
              </h3>
              {top.length === 0 ? (
                <p className="text-sm text-text-muted">No closer activity {WORD[period]} yet.</p>
              ) : (
                <ol className="space-y-2" data-testid="ov-top-closers">
                  {top.map((r, i) => (
                    <li key={r.code || r.agent.id} className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                      <span className="w-6 text-center font-heading font-bold text-text-muted">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{r.agent.name}</span>
                      <span className="text-xs text-text-muted tabular">{r.counts.submitted} sub</span>
                      <span className="w-10 text-right font-heading font-bold text-emerald-300 tabular">{r.counts.validated}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          {period === "day" && (
            <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 p-6">
              <h3 className="mb-4 flex items-center gap-2 font-heading text-base font-bold text-white">
                <Clock className="h-4 w-4 text-secondary" /> Latest validated sales
              </h3>
              {d.sales.length === 0 ? (
                <p className="text-sm text-text-muted">No validated sales today yet.</p>
              ) : (
                <ul className="divide-y divide-white/[0.05]" data-testid="ov-latest-sales">
                  {d.sales.slice(0, 10).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="truncate font-semibold text-white">{s.closerName ?? s.closerCode ?? "Closer"}</span>
                      <span className="text-text-muted">{s.carrier ?? s.product}</span>
                      <span className="tabular text-text-secondary">
                        {new Date(s.approvedAt ?? s.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: timezone })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="text-xs text-text-muted">Updated {new Date(d.fetchedAt).toLocaleTimeString()}.</p>
        </>
      )}
    </div>
  );
}
