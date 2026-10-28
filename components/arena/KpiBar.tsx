"use client";

import { AnimatedCounter } from "./AnimatedCounter";
import type { ArenaStatistics } from "@/types";
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
  const percentStr = `${Math.round(stats.completion * 100)}%`;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 gap-3">
      {/* 1. Total Approved Sales */}
      <div className="rounded-2xl border border-emerald-500/25 bg-[#0D1426]/80 p-4 backdrop-blur-md glow-success">
        <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
          <span>APPROVED SALES</span>
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="font-heading text-3xl font-black text-white tracking-tight kpi-number">
          <AnimatedCounter value={stats.approvedToday} />
        </div>
        <div className="text-[11px] font-mono text-emerald-400 mt-1">
          +${(stats.approvedToday * 95).toLocaleString()} est. volume
        </div>
      </div>

      {/* 2. Today's Target */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1426]/80 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
          <span>TODAY&apos;S TARGET</span>
          <Target className="w-4 h-4 text-secondary" />
        </div>
        <div className="font-heading text-3xl font-black text-white tracking-tight kpi-number">
          <AnimatedCounter value={stats.targetToday} />
        </div>
        <div className="text-[11px] font-mono text-muted mt-1">
          Across {stats.teams} active teams
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
            style={{ width: `${Math.min(100, stats.completion * 100)}%` }}
          />
        </div>
      </div>

      {/* 4. Remaining Sales to Target */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1426]/80 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
          <span>REMAINING</span>
          <Flame className="w-4 h-4 text-gold" />
        </div>
        <div className="font-heading text-3xl font-black text-gold tracking-tight kpi-number">
          <AnimatedCounter value={stats.remaining} />
        </div>
        <div className="text-[11px] font-mono text-muted mt-1">
          To floor victory
        </div>
      </div>

      {/* 5. Unlocked Spins */}
      <div className="rounded-2xl border border-primary/25 bg-[#0D1426]/80 p-4 backdrop-blur-md glow-primary">
        <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
          <span>SPINS UNLOCKED</span>
          <Disc3 className="w-4 h-4 text-primary" />
        </div>
        <div className="font-heading text-3xl font-black text-primary tracking-tight kpi-number">
          <AnimatedCounter value={stats.spinsUnlocked} />
        </div>
        <div className="text-[11px] font-mono text-secondary mt-1">
          {stats.spinsAvailable} spins ready
        </div>
      </div>

      {/* 6. Active Agents on Floor */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1426]/80 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between text-muted text-xs font-semibold mb-1">
          <span>ACTIVE AGENTS</span>
          <Users className="w-4 h-4 text-text-secondary" />
        </div>
        <div className="font-heading text-3xl font-black text-white tracking-tight kpi-number">
          <AnimatedCounter value={stats.activeAgents} />
        </div>
        <div className="text-[11px] font-mono text-muted mt-1">
          {stats.totalAgents} on roster
        </div>
      </div>
    </div>
  );
}
