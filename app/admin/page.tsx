"use client";

import { useMemo } from "react";
import { useArenaStore } from "@/store/arena-store";
import { computeArenaStatistics, hourlySales, dailyTotals } from "@/features/sales/stats";
import { AnimatedCounter } from "@/components/arena/AnimatedCounter";
import { 
  CheckCircle2, 
  Users, 
  Shield, 
  Target, 
  Disc3, 
  Gift, 
  TrendingUp, 
  ArrowUpRight 
} from "lucide-react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function AdminOverviewPage() {
  const store = useArenaStore();
  const stats = useMemo(() => computeArenaStatistics(store), [store]);
  const hourly = useMemo(() => hourlySales(store), [store]);

  return (
    <div className="space-y-6">
      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-2xl border border-white/10 bg-[#0D1426]/90 p-4">
          <span className="text-xs font-semibold text-muted block mb-1">APPROVED SALES</span>
          <span className="font-heading text-2xl font-black text-white">
            <AnimatedCounter value={stats.approvedToday} />
          </span>
          <span className="text-[10px] font-mono text-emerald-400 block mt-1">Today</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0D1426]/90 p-4">
          <span className="text-xs font-semibold text-muted block mb-1">TOTAL AGENTS</span>
          <span className="font-heading text-2xl font-black text-white">
            <AnimatedCounter value={stats.totalAgents} />
          </span>
          <span className="text-[10px] font-mono text-secondary block mt-1">
            {stats.activeAgents} active
          </span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0D1426]/90 p-4">
          <span className="text-xs font-semibold text-muted block mb-1">TOTAL TEAMS</span>
          <span className="font-heading text-2xl font-black text-white">
            <AnimatedCounter value={stats.teams} />
          </span>
          <span className="text-[10px] font-mono text-muted block mt-1">Campaign squads</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0D1426]/90 p-4">
          <span className="text-xs font-semibold text-muted block mb-1">ACTIVE RULES</span>
          <span className="font-heading text-2xl font-black text-white">
            <AnimatedCounter value={stats.activeTargets} />
          </span>
          <span className="text-[10px] font-mono text-muted block mt-1">Target rules</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0D1426]/90 p-4">
          <span className="text-xs font-semibold text-muted block mb-1">SPINS ISSUED</span>
          <span className="font-heading text-2xl font-black text-primary">
            <AnimatedCounter value={stats.spinsUnlocked} />
          </span>
          <span className="text-[10px] font-mono text-muted block mt-1">
            {stats.spinsUsed} used
          </span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0D1426]/90 p-4">
          <span className="text-xs font-semibold text-muted block mb-1">PRIZES WON</span>
          <span className="font-heading text-2xl font-black text-gold">
            <AnimatedCounter value={stats.rewardsIssued} />
          </span>
          <span className="text-[10px] font-mono text-muted block mt-1">Fulfilled</span>
        </div>
      </div>

      {/* Hourly Sales Performance Chart */}
      <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 p-6 backdrop-blur-md">
        <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4">
          <div>
            <h3 className="font-heading text-base font-bold text-white">
              Hourly Sales Performance
            </h3>
            <p className="text-xs text-muted">
              Volume velocity throughout today&apos;s shift
            </p>
          </div>
          <span className="px-2.5 py-0.5 rounded-full bg-secondary/15 text-secondary text-xs font-mono font-bold">
            TELEMETRY
          </span>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={hourly} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7568FF" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#7568FF" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="hour" stroke="#7483A0" fontSize={11} />
              <YAxis stroke="#7483A0" fontSize={11} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#121C32",
                  borderColor: "rgba(117, 104, 255, 0.3)",
                  borderRadius: "12px",
                  fontSize: "12px",
                }}
              />
              <Area
                type="monotone"
                dataKey="sales"
                name="Approved Sales"
                stroke="#7568FF"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#salesGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          href="/admin/agents"
          className="group rounded-2xl border border-white/10 bg-surface/50 p-5 hover:border-primary/40 hover:bg-surface transition-all flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <Users className="w-5 h-5 text-secondary group-hover:scale-110 transition-transform" />
            <ArrowUpRight className="w-4 h-4 text-muted group-hover:text-white" />
          </div>
          <div className="mt-4">
            <h4 className="font-heading font-bold text-white text-sm">Agent Roster</h4>
            <p className="text-xs text-muted mt-0.5">Manage agents and team rosters</p>
          </div>
        </Link>

        <Link
          href="/admin/targets"
          className="group rounded-2xl border border-white/10 bg-surface/50 p-5 hover:border-primary/40 hover:bg-surface transition-all flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <Target className="w-5 h-5 text-gold group-hover:scale-110 transition-transform" />
            <ArrowUpRight className="w-4 h-4 text-muted group-hover:text-white" />
          </div>
          <div className="mt-4">
            <h4 className="font-heading font-bold text-white text-sm">Target Rules</h4>
            <p className="text-xs text-muted mt-0.5">Configure sales required per spin</p>
          </div>
        </Link>

        <Link
          href="/admin/rewards"
          className="group rounded-2xl border border-white/10 bg-surface/50 p-5 hover:border-primary/40 hover:bg-surface transition-all flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <Gift className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
            <ArrowUpRight className="w-4 h-4 text-muted group-hover:text-white" />
          </div>
          <div className="mt-4">
            <h4 className="font-heading font-bold text-white text-sm">Prize Wheel Catalog</h4>
            <p className="text-xs text-muted mt-0.5">Add, edit, reorder wheel prizes</p>
          </div>
        </Link>

        <Link
          href="/admin/integrations"
          className="group rounded-2xl border border-white/10 bg-surface/50 p-5 hover:border-primary/40 hover:bg-surface transition-all flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <Disc3 className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform" />
            <ArrowUpRight className="w-4 h-4 text-muted group-hover:text-white" />
          </div>
          <div className="mt-4">
            <h4 className="font-heading font-bold text-white text-sm">Dialer Sync Preview</h4>
            <p className="text-xs text-muted mt-0.5">Inspect incoming dialer webhooks</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
