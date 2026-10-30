"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Target, Save, History, CalendarDays } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Notice, Table, fmtDate } from "@/components/admin/spins/shared";
import { useSettingsStore } from "@/store/settings-store";
import { periodInfo } from "@/lib/time/business";
import { targetProgress, formatPercent, periodStartFor, periodEndFor, type TargetPeriod } from "@/lib/live/targets";
import { cn } from "@/lib/utils";

interface StoredTarget {
  periodType: TargetPeriod;
  periodKey: string;
  target: number;
  note: string | null;
  updatedAt: string;
  updatedBy: string | null;
}
interface HistoryRow {
  id: string;
  periodType: TargetPeriod;
  periodKey: string;
  oldTarget: number | null;
  newTarget: number;
  note: string | null;
  changedAt: string;
  changedBy: string | null;
}

const PERIODS: Array<{ id: TargetPeriod; label: string }> = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
];

const fmtDay = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Admin → Target Management: validated-sales targets per day / week / month, stored in PostgreSQL. */
export default function TargetManagementPage() {
  const timezone = useSettingsStore((s) => s.businessTimezone) || "America/New_York";
  const weekStartDay = useSettingsStore((s) => s.weekStartDay) ?? 1;
  const today = useMemo(() => periodInfo("day", { timezone, weekStartDay }).today, [timezone, weekStartDay]);

  const [period, setPeriod] = useState<TargetPeriod>("day");
  const [date, setDate] = useState(today);
  const periodKey = periodStartFor(period, date, weekStartDay);
  const periodEnd = periodEndFor(period, date, weekStartDay);
  const queryTo = periodEnd > today ? today : periodEnd;

  const [current, setCurrent] = useState<StoredTarget | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [completed, setCompleted] = useState<number | null>(null);
  const [completedError, setCompletedError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await adminApi<{ targets: Record<TargetPeriod, StoredTarget | null>; history: HistoryRow[] }>(
      `/api/admin/targets?${period}=${periodKey}&limit=50`,
    );
    if (r.ok) {
      const t = r.data.targets[period];
      setCurrent(t);
      setHistory(r.data.history);
      setValue(t ? String(t.target) : "");
    } else setMsg({ kind: "error", text: r.error });

    // Completed = validated sales from Safe Quote for this period (future periods have none yet).
    if (periodKey > today) {
      setCompleted(0);
      setCompletedError(null);
      return;
    }
    try {
      const res = await fetch(`/api/arena/summary?from=${periodKey}&to=${queryTo}`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok && j.ok) {
        setCompleted(Number(j.data?.validated ?? 0));
        setCompletedError(null);
      } else {
        setCompleted(null);
        setCompletedError(j.error ?? j.message ?? "Safe Quote is unavailable.");
      }
    } catch {
      setCompleted(null);
      setCompletedError("Safe Quote is unavailable.");
    }
  }, [period, periodKey, queryTo, today]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      setMsg({ kind: "error", text: "Enter a whole number (0 clears the target)." });
      return;
    }
    setSaving(true);
    setMsg(null);
    const r = await adminApi<{ target: StoredTarget; previous: number | null }>("/api/admin/targets", {
      method: "PUT",
      body: { periodType: period, periodKey, target: n, note: note.trim() || undefined },
    });
    setSaving(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error });
    setNote("");
    setMsg({ kind: "ok", text: n === 0 ? "Target cleared." : `Target saved: ${n.toLocaleString()} validated sales.` });
    await load();
  };

  const progress = targetProgress(completed ?? 0, current?.target ?? null);
  const preview = targetProgress(completed ?? 0, Number(value) || null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-bold text-white">
          <Target className="h-6 w-6 text-secondary" /> Target Management
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Validated-sales targets for the FE floor. Completed counts come from Safe Quote; targets are saved in PostgreSQL. Business timezone: {timezone}.
        </p>
      </div>

      <section className="rounded-2xl border border-white/[0.07] bg-[#0D1426]/70 p-5 space-y-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">Period</p>
            <div role="tablist" className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={period === p.id}
                  onClick={() => setPeriod(p.id)}
                  className={cn(
                    "rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
                    period === p.id ? "bg-primary text-white shadow" : "text-text-muted hover:text-white",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
              <CalendarDays className="h-3.5 w-3.5" /> Business date
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-xl border border-white/10 bg-[#0A0F1E] px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
          </label>
          <p className="pb-2 text-sm text-text-secondary" data-testid="target-period-range">
            {period === "day" ? fmtDay(periodKey) : `${fmtDay(periodKey)} – ${fmtDay(periodEnd)}`}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Target", value: progress.target === null ? "Not set" : progress.target.toLocaleString(), id: "target-current" },
            { label: "Completed", value: completed === null ? "—" : completed.toLocaleString(), id: "target-completed" },
            { label: "Remaining", value: progress.remaining === null ? "—" : progress.remaining.toLocaleString(), id: "target-remaining" },
            { label: "Completion", value: formatPercent(progress.percent), id: "target-percent" },
          ].map((s) => (
            <div key={s.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{s.label}</p>
              <p className="mt-1 font-heading text-2xl font-bold text-white tabular" data-testid={s.id}>
                {s.value}
              </p>
            </div>
          ))}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-700"
            style={{ width: `${Math.min(100, progress.percent ?? 0)}%` }}
          />
        </div>
        {completedError && <Notice kind="info">Completed count unavailable: {completedError}</Notice>}
        <p className="text-xs text-text-muted" data-testid="target-updated-by">
          {current ? `Last updated ${fmtDate(current.updatedAt)} by ${current.updatedBy ?? "a removed admin"}${current.note ? ` — “${current.note}”` : ""}` : "No target saved for this period yet."}
        </p>
      </section>

      <section className="rounded-2xl border border-white/[0.07] bg-[#0D1426]/70 p-5 space-y-4">
        <h2 className="font-heading text-lg font-bold text-white">Set target</h2>
        <div className="grid gap-4 sm:grid-cols-[200px_1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">Validated sales</span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 40"
              data-testid="target-input"
              className="w-full rounded-xl border border-white/10 bg-[#0A0F1E] px-3 py-2 text-white"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">Note (optional)</span>
            <input
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why it changed"
              className="w-full rounded-xl border border-white/10 bg-[#0A0F1E] px-3 py-2 text-white"
            />
          </label>
          <button
            onClick={save}
            disabled={saving || value === ""}
            data-testid="target-save"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save target"}
          </button>
        </div>
        {value !== "" && Number(value) > 0 && completed !== null && (
          <p className="text-sm text-text-secondary">
            Preview: {completed.toLocaleString()} of {Number(value).toLocaleString()} → {formatPercent(preview.percent)} complete, {preview.remaining?.toLocaleString()} remaining.
          </p>
        )}
        <p className="text-xs text-text-muted">Set 0 to clear the target (shows “Not set”). Every change is recorded with your account.</p>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </section>

      <section className="rounded-2xl border border-white/[0.07] bg-[#0D1426]/70 p-5 space-y-4">
        <h2 className="flex items-center gap-2 font-heading text-lg font-bold text-white">
          <History className="h-5 w-5 text-secondary" /> Change history
        </h2>
        <Table head={["When", "Period", "Starts", "From", "To", "By", "Note"]} empty={history.length === 0} testId="target-history">
          {history.map((h) => (
            <tr key={h.id} className="border-t border-white/[0.05]">
              <td className="px-3 py-2 text-text-secondary">{fmtDate(h.changedAt)}</td>
              <td className="px-3 py-2 capitalize text-white">{h.periodType === "day" ? "Daily" : h.periodType === "week" ? "Weekly" : "Monthly"}</td>
              <td className="px-3 py-2 text-text-secondary">{h.periodKey}</td>
              <td className="px-3 py-2 tabular text-text-muted">{h.oldTarget ?? "—"}</td>
              <td className="px-3 py-2 tabular font-semibold text-white">{h.newTarget === 0 ? "Cleared" : h.newTarget}</td>
              <td className="px-3 py-2 text-text-secondary">{h.changedBy ?? "—"}</td>
              <td className="px-3 py-2 text-text-muted">{h.note ?? ""}</td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  );
}
