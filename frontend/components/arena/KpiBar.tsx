"use client";

import React, { memo } from "react";
import { AnimatedCounter } from "./AnimatedCounter";
import type { ArenaStatistics } from "@/shared/types";
import { useArenaStore } from "@/frontend/stores/arena-store";
import { useLiveStore } from "@/frontend/stores/live-store";
import { targetProgress, formatPercent } from "@/shared/live/targets";
import { 
  CheckCircle2, 
  Target, 
  TrendingUp, 
  Users, 
  Disc3, 
  Flame 
} from "lucide-react";

/** `showSpinCredits` = false (Daily Arena) leaves out ONLY the Spin Credits card; spin data and Spin & Win are untouched. */
export const KpiBar = memo(function KpiBar({ stats, showSpinCredits = true }: { stats: ArenaStatistics; showSpinCredits?: boolean }) {
  const summary = useArenaStore((s) => s.periodMetrics?.day?.summary ?? s.safeQuoteSummary);
  const serverSpinBalance = useArenaStore((s) => s.serverSpinBalance);

  const liveMode = useArenaStore((s) => s.liveMode);
  // Live mode: every number comes from Safe Quote / PostgreSQL. Without a source it shows "—", never an estimate.
  const approvedCount = summary ? summary.validated : liveMode ? null : stats.approvedToday;
  const volumeStr = summary
    ? typeof summary.premium?.total === "number"
      ? `+$${Math.round(summary.premium.total).toLocaleString()} total premium`
      : "Premium not reported"
    : liveMode
      ? "Premium unavailable"
      : `+$${(stats.approvedToday * 95).toLocaleString()} est. volume (demo)`;
  const liveTarget = useLiveStore((s) => s.targets.day);
  // Live: target from PostgreSQL (Admin → Target Management). Demo: the simulated floor target.
  const progress = targetProgress(approvedCount ?? 0, liveMode ? (approvedCount === null ? null : liveTarget) : stats.targetToday);
  const completionRate = (progress.percent ?? 0) / 100;
  const percentStr = formatPercent(progress.percent);
  const remainingCount = progress.remaining;
  const activeCount = summary ? summary.activeClosers : liveMode ? null : stats.activeAgents;
  const activeSub = summary ? `${summary.submitted} submitted leads` : liveMode ? "Unavailable" : `${stats.totalAgents} on roster`;
  const remainingSub = summary ? `${summary.returned} returned · ${summary.rejected} rejected` : liveMode ? "" : "To floor victory";
  // Spin credits (PostgreSQL ledger) — separate from cash bonuses.
  const unlockedCount = serverSpinBalance ? serverSpinBalance.unlocked : liveMode ? null : stats.spinsUnlocked;
  const availableCount = serverSpinBalance ? serverSpinBalance.available : liveMode ? null : stats.spinsAvailable;
  const dash = <span className="text-2xl text-text-muted">—</span>;

  return (
    <div className={showSpinCredits ? "grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3" : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"} data-testid="kpi-bar" data-cards={showSpinCredits ? 6 : 5}>
      {/* 1. Total Approved Sales */}
      <Card accent="#36E0B5" label="APPROVED SALES" icon={<CheckCircle2 className="h-4 w-4" />}>
        <div className="font-heading font-black text-white kpi-number">{approvedCount === null ? dash : <AnimatedCounter value={approvedCount} />}</div>
        <div className="ac-kpi__sub font-mono text-emerald-300">{volumeStr}</div>
      </Card>

      {/* 2. Today's Target */}
      <Card accent="#22D3FF" label="TODAY'S TARGET" icon={<Target className="h-4 w-4" />}>
        <div className="font-heading font-black text-white kpi-number">
          {progress.target === null ? <span className="text-2xl text-text-muted" data-testid="target-not-set">Not set</span> : <AnimatedCounter value={progress.target} />}
        </div>
        <div className="ac-kpi__sub">{progress.target === null ? "Set it in Admin → Targets" : "Validated sales goal"}</div>
      </Card>

      {/* 3. Target Completion % */}
      <Card accent="#27D5FF" label="COMPLETION" icon={<TrendingUp className="h-4 w-4" />}>
        <div className="font-heading font-black text-secondary kpi-number">{percentStr}</div>
        <div className="ac-kpi__bar">
          <div style={{ width: `${Math.min(100, completionRate * 100)}%` }} />
        </div>
        {summary && <div className="ac-kpi__sub font-mono">{summary.closeRate.toFixed(1)}% close rate</div>}
      </Card>

      {/* 4. Remaining Sales to Target */}
      <Card accent="#FFC857" label="REMAINING" icon={<Flame className="h-4 w-4" />}>
        <div className="font-heading font-black text-gold kpi-number">{remainingCount === null ? <span className="text-2xl text-text-muted">—</span> : <AnimatedCounter value={remainingCount} />}</div>
        <div className="ac-kpi__sub font-mono">{remainingSub}</div>
      </Card>

      {/* 5. Spin credits (Spin & Win screen only) */}
      {showSpinCredits && (
        <Card accent="#7568FF" label="SPIN CREDITS" icon={<Disc3 className="h-4 w-4" />} testId="kpi-spin-credits">
          <div className="font-heading font-black text-primary kpi-number">{unlockedCount === null ? dash : <AnimatedCounter value={unlockedCount} />}</div>
          <div className="ac-kpi__sub font-mono text-secondary">{availableCount === null ? "Spin credits unavailable" : `${availableCount} spin credit${availableCount === 1 ? "" : "s"} ready`}</div>
        </Card>
      )}

      {/* 6. Active Agents on Floor (spans the last row when there are five cards, so no gap is left) */}
      <Card accent="#FF7AD9" label="ACTIVE AGENTS" icon={<Users className="h-4 w-4" />} className={showSpinCredits ? "" : "col-span-2 sm:col-span-2 lg:col-span-1"}>
        <div className="font-heading font-black text-white kpi-number">{activeCount === null ? dash : <AnimatedCounter value={activeCount} />}</div>
        <div className="ac-kpi__sub font-mono">{activeSub}</div>
      </Card>
    </div>
  );
});

/** One KPI card: label, tinted icon, big number (children), accent light along the top edge. */
function Card({ accent, label, icon, children, className = "", testId }: { accent: string; label: string; icon: React.ReactNode; children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div data-testid={testId} className={`ac-kpi ${className}`} style={{ ["--ac" as string]: accent } as React.CSSProperties}>
      <div className="ac-kpi__head">
        <span className="ac-kpi__label">{label}</span>
        <span className="ac-kpi__icon">{icon}</span>
      </div>
      {children}
    </div>
  );
}
