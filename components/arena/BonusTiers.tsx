"use client";

import { useMemo } from "react";
import { Layers, Gift, Users } from "lucide-react";
import { useRewardsStore, type BonusProgram } from "@/store/rewards-store";
import { useSettingsStore } from "@/store/settings-store";
import { useArenaStore } from "@/store/arena-store";
import { useLiveStore } from "@/store/live-store";
import { usePeriodInfo } from "@/components/arena/LiveLeaderboard";
import { cn } from "@/lib/utils";

type Kind = "daily" | "weekly" | "monthly";
const META: Record<Kind, { label: string; word: string; period: "day" | "week" | "month"; accent: string }> = {
  daily: { label: "DAILY BONUS TIERS", word: "today", period: "day", accent: "#FFC857" },
  weekly: { label: "WEEKLY BONUS TIERS", word: "this week", period: "week", accent: "#22D3FF" },
  monthly: { label: "MONTHLY BONUS TIERS", word: "this month", period: "month", accent: "#B58CFF" },
};

const money = (currency: string, v: number) => `${currency} ${Math.round(v).toLocaleString("en-US")}`;

/** Each tier plus the running total an agent has earned on reaching it (stackable cash tiers only). */
export function tierRows(programs: BonusProgram[]) {
  const sorted = [...programs].sort((a, b) => a.salesRequired - b.salesRequired);
  let running = 0;
  return sorted.map((p) => {
    const cash = (p.rewardType ?? "cash") === "cash";
    const stackable = p.stackable !== false;
    if (cash && stackable) running += p.amount;
    return { program: p, cash, stackable, total: cash && stackable ? running : null };
  });
}

/**
 * Live Arena: the active Daily / Weekly / Monthly bonus programs exactly as configured in Admin →
 * Reward Programs (PostgreSQL), plus the cash actually earned in the current period (bonus_awards).
 * Nothing here is hard-coded; loading, empty, paused and unavailable states are shown as such.
 */
export function BonusTierStrip({ kind }: { kind: Kind }) {
  const meta = META[kind];
  const liveMode = useArenaStore((s) => s.liveMode);
  const cat = useSettingsStore((s) => s.rewardCategories[kind]);
  const fallbackCurrency = useSettingsStore((s) => s.currencyLabel);
  const allPrograms = useRewardsStore((s) => s.programs);
  const localAwards = useRewardsStore((s) => s.awards);
  const liveProgramsStatus = useLiveStore((s) => s.programsStatus);
  const programsStatus = liveMode ? liveProgramsStatus : "ok";
  const summary = useLiveStore((s) => s.awardSummary?.[kind] ?? null);
  const summaryStatus = useLiveStore((s) => s.awardSummaryStatus);
  const info = usePeriodInfo(meta.period);

  const programs = useMemo(() => allPrograms.filter((p) => p.kind === kind && p.enabled), [allPrograms, kind]);
  const rows = useMemo(() => tierRows(programs), [programs]);
  const allStackable = rows.length > 1 && rows.every((r) => r.stackable);

  // Earned this period: live = PostgreSQL totals; demo = this browser's demo awards.
  const earned = useMemo(() => {
    if (liveMode) return summary ? { amount: summary.earned, count: summary.count, currency: summary.currency } : null;
    const list = localAwards.filter((a) => a.kind === kind && a.periodKey === info.key);
    return { amount: list.reduce((t, a) => t + a.amount, 0), count: list.length, currency: fallbackCurrency };
  }, [liveMode, summary, localAwards, kind, info.key, fallbackCurrency]);

  if (!cat.showOnArena) return null; // Admin: category hidden from the Live Arena

  const shell = "rounded-2xl border bg-[#0B1122]/80 px-4 py-3";
  if (!cat.active)
    return (
      <div className={cn(shell, "border-white/10 text-sm text-text-muted")} data-testid={`bonus-tiers-${kind}`} data-state="paused">
        <span className="font-bold tracking-[0.2em] text-text-secondary">{meta.label}</span> · {kind[0].toUpperCase() + kind.slice(1)} bonuses are paused.
      </div>
    );

  const empty = rows.length === 0;
  return (
    <section className={shell} style={{ borderColor: `${meta.accent}33` }} data-testid={`bonus-tiers-${kind}`} data-state={empty ? (programsStatus === "ok" ? "empty" : programsStatus) : "ready"} aria-label={meta.label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="h-4 w-4" style={{ color: meta.accent }} />
          <span className="text-xs font-bold tracking-[0.25em]" style={{ color: meta.accent }}>{meta.label}</span>
          {allStackable && (
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold tracking-[0.15em] text-emerald-300" data-testid="tiers-stackable">
              STACKABLE · EARN EVERY TIER YOU REACH
            </span>
          )}
        </div>
        <span
          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-text-secondary"
          title="Cash bonuses earned (not necessarily paid yet). Cancelled and reversed awards are excluded."
          data-testid={`bonus-earned-${kind}`}
        >
          {earned ? (
            <>
              <b className="text-white">{money(earned.currency, earned.amount)}</b> earned {meta.word}
              {earned.count > 0 && <span className="text-text-muted"> · {earned.count} award{earned.count === 1 ? "" : "s"}</span>}
            </>
          ) : summaryStatus === "error" ? (
            <span className="text-text-muted">Earned {meta.word}: unavailable</span>
          ) : (
            <span className="text-text-muted">Loading earned bonuses…</span>
          )}
        </span>
      </div>

      {empty ? (
        <p className="mt-2 text-sm text-text-muted">
          {programsStatus === "loading" ? "Loading bonus programs…" : programsStatus === "error" ? "Bonus programs are unavailable right now." : `No active ${kind} bonus programs right now.`}
        </p>
      ) : (
        <ol className="mt-2.5 grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${rows.length > 4 ? 120 : 140}px, 1fr))` }} data-testid="bonus-tier-list">
          {rows.map(({ program: p, cash, stackable, total }, i) => (
            <li
              key={p.id}
              className="min-w-0 rounded-xl border bg-white/[0.03] px-3 py-2"
              style={{ borderColor: `${p.accent || meta.accent}40` }}
              data-testid="bonus-tier"
              data-sales={p.salesRequired}
              data-amount={cash ? p.amount : undefined}
              title={p.name}
            >
              <div className="flex items-center justify-between gap-2 text-[10px] font-bold tracking-[0.14em] text-text-muted">
                <span>{p.salesRequired} VALIDATED SALE{p.salesRequired === 1 ? "" : "S"}</span>
                {p.limitedEligibility && <Users className="h-3 w-3 shrink-0" aria-label="Selected agents only" />}
              </div>
              <div className="mt-0.5 truncate font-heading text-lg font-black tabular xl:text-xl" style={{ color: p.accent || meta.accent }}>
                {cash ? `${i > 0 && stackable ? "+" : ""}${money(p.currency || fallbackCurrency, p.amount)}` : <span className="inline-flex items-center gap-1"><Gift className="h-4 w-4" />{p.prizeLabel}</span>}
              </div>
              <div className="truncate text-[11px] text-text-muted">
                {total !== null && i > 0 ? `Total ${money(p.currency || fallbackCurrency, total)}` : !stackable ? "Not stackable" : cash ? "Bonus" : "Reward"}
                {p.maxAwards > 1 ? ` · up to ${p.maxAwards}×` : ""}
                {p.limitedEligibility ? " · selected agents" : ""}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
