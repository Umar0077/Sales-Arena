"use client";

import { AnimatedCounter } from "./AnimatedCounter";
import type { ArenaStatistics } from "@/types";
import { useArenaStore } from "@/store/arena-store";
import { useLiveStore } from "@/store/live-store";
import { targetProgress, formatPercent } from "@/lib/live/targets";
import { 
  CheckCircle2, 
  Target, 
  TrendingUp, 
  Users, 
  Sparkles, 
  Disc3, 
  Flame 
} from "lucide-react";

export function KpiBar({ stats }: { stats: ArenaStatistics }) {
  const summary = useArenaStore((s) => s.periodMetrics?.day?.summary ?? s.safeQuoteSummary);
  const serverSpinBalance = useArenaStore((s) => s.serverSpinBalance);

  const approvedCount = summary ? summary.validated : stats.approvedToday;
  const volumeStr = summary?.premium?.total
    ? `+$${Math.round(summary.premium.total).toLocaleString()} total premium`
    : `+$${(stats.approvedToday * 95).toLocaleString()} est. volume`;
  const liveMode = useArenaStore((s) => s.liveMode);
  const liveTarget = useLiveStore((s) => s.targets.day);
  // Live: target from PostgreSQL (Admin → Target Management). Demo: the simulated floor target.
  const progress = targetProgress(approvedCount, liveMode ? liveTarget : stats.targetToday);
  const completionRate = (progress.percent ?? 0) / 100;
  const percentStr = formatPercent(progress.percent);
  const remainingCount = progress.remaining;
  const activeCount = summary ? summary.activeClosers : stats.activeAgents;
  const activeSub = summary ? `${summary.submitted} submitted leads` : `${stats.totalAgents} on roster`;
  const remainingSub = summary ? `${summary.returned} returned · ${summary.rejected} rejected` : "To floor victory";
  const unlockedCount = serverSpinBalance ? serverSpinBalance.unlocked : stats.spinsUnlocked;
  const availableCount = serverSpinBalance ? serverSpinBalance.available : stats.spinsAvailable;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 gap-3">
      {/* 1. Total Approved Sales */}
      <div className="rounded-2xl border border-emerald-500/25 bg-[#0D1426]/80 p-4 backdrop-blur-md glow-success">
        <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
          <span>APPROVED SALES</span>
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="font-heading text-3xl font-black text-white tracking-tight kpi-number">
          <AnimatedCounter value={approvedCount} />
        </div>
        <div className="text-[11px] font-mono text-emerald-400 mt-1">
          {volumeStr}
        </div>
      </div>

      {/* 2. Today's Target */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1426]/80 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
          <span>TODAY&apos;S TARGET</span>
          <Target className="w-4 h-4 text-secondary" />
        </div>
        <div className="font-heading text-3xl font-black text-white tracking-tight kpi-number">
          {progress.target === null ? <span className="text-2xl text-text-muted" data-testid="target-not-set">Not set</span> : <AnimatedCounter value={progress.target} />}
        </div>
        <div className="text-[11px] font-mono text-muted mt-1">
          {progress.target === null ? "Set it in Admin → Targets" : "Validated sales goal"}
        </div>
      </div>

      {/* 3. Target Completion % */}
      <div className="rounded-2xl border border-secondary/25 bg-[#0D1426]/80 p-4 backdrop-blur-md glow-cyan">
        <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
          <span>COMPLETION</span>
          <TrendingUp className="w-4 h-4 text-secondary" />
        </div>
        <div className="font-heading text-3xl font-black text-secondary tracking-tight kpi-number">
          {percentStr}
        </div>
        <div className="w-full bg-white/10 h-1.5 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all duration-700"
            style={{ width: `${Math.min(100, completionRate * 100)}%` }}
          />
        </div>
        {summary && (
          <div className="text-[11px] font-mono text-muted mt-1">
            {summary.closeRate.toFixed(1)}% close rate
          </div>
        )}
      </div>

      {/* 4. Remaining Sales to Target */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1426]/80 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
          <span>REMAINING</span>
          <Flame className="w-4 h-4 text-gold" />
        </div>
        <div className="font-heading text-3xl font-black text-gold tracking-tight kpi-number">
          {remainingCount === null ? <span className="text-2xl text-text-muted">—</span> : <AnimatedCounter value={remainingCount} />}
        </div>
        <div className="text-[11px] font-mono text-muted mt-1">
          {remainingSub}
        </div>
      </div>

      {/* 5. Unlocked Spins */}
      <div className="rounded-2xl border border-primary/25 bg-[#0D1426]/80 p-4 backdrop-blur-md glow-primary">
        <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
          <span>SPINS UNLOCKED</span>
          <Disc3 className="w-4 h-4 text-primary" />
        </div>
        <div className="font-heading text-3xl font-black text-primary tracking-tight kpi-number">
          <AnimatedCounter value={unlockedCount} />
        </div>
        <div className="text-[11px] font-mono text-secondary mt-1">
          {availableCount} spins ready
        </div>
      </div>

      {/* 6. Active Agents on Floor */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1426]/80 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
          <span>ACTIVE AGENTS</span>
          <Users className="w-4 h-4 text-text-secondary" />
        </div>
        <div className="font-heading text-3xl font-black text-white tracking-tight kpi-number">
          <AnimatedCounter value={activeCount} />
        </div>
        <div className="text-[11px] font-mono text-muted mt-1">
          {activeSub}
        </div>
      </div>
    </div>
  );
}
