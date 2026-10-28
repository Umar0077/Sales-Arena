"use client";

import { useMemo, useState } from "react";
import { useArenaStore } from "@/store/arena-store";
import { computeSpinCredit, ruleForTeam } from "@/features/targets/eligibility";
import { computeLeaderboard } from "@/features/sales/stats";
import { AnimatedCounter } from "@/components/arena/AnimatedCounter";
import { 
  Trophy, 
  Disc3, 
  Target, 
  TrendingUp, 
  Award, 
  History, 
  Sparkles, 
  CheckCircle2, 
  ChevronRight, 
  UserCheck, 
  Calendar,
  Gift
} from "lucide-react";
import Link from "next/link";
import { TimeAgo } from "@/components/common/TimeAgo";

export default function AgentDashboardPage() {
  const store = useArenaStore();
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    store.currentAgentId || store.agents[0]?.id || ""
  );

  const agent = store.agents.find((a) => a.id === selectedAgentId) || store.agents[0];
  const team = store.teams.find((t) => t.id === agent?.teamId);
  const campaign = store.campaigns.find((c) => c.id === agent?.campaignId);

  // Target Rule for agent's team
  const rule = useMemo(() => {
    return ruleForTeam(store.targetRules, agent?.teamId);
  }, [store.targetRules, agent?.teamId]);

  // Approved sales today
  const approvedSalesToday = useMemo(() => {
    if (!agent) return [];
    return store.sales.filter((s) => s.agentId === agent.id && s.status === "approved");
  }, [store.sales, agent]);

  // Spin credits
  const credit = useMemo(() => {
    if (!agent) return null;
    return computeSpinCredit(store, agent.id);
  }, [store, agent]);

  // Current rank
  const rank = useMemo(() => {
    if (!agent) return null;
    const board = computeLeaderboard(store, { period: "daily" });
    const entry = board.find((e) => e.agent.id === agent.id);
    return entry?.rank || "--";
  }, [store, agent]);

  // Agent's personal spin wins
  const personalSpins = useMemo(() => {
    if (!agent) return [];
    return store.spins.filter((s) => s.agentId === agent.id);
  }, [store.spins, agent]);

  // Target progress
  const targetGoal = rule.agentDailyTarget;
  const progressPercent = Math.min(100, Math.round((approvedSalesToday.length / targetGoal) * 100));

  // Next milestone calculation
  const salesToNextSpin = credit?.salesToNext ?? (rule.salesPerSpin - (approvedSalesToday.length % rule.salesPerSpin));

  return (
    <div className="space-y-6">
      {/* Header with Agent Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl font-heading text-2xl font-black text-white shadow-xl"
            style={{ backgroundColor: team?.color || "#7568FF" }}
          >
            {agent?.initials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-2xl lg:text-3xl font-black text-white tracking-tight">
                {agent?.name}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-semibold">
                ACTIVE AGENT
              </span>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              {team?.name || "Titans"} · {agent?.title} · {campaign?.name}
            </p>
          </div>
        </div>

        {/* Switch Agent Dropdown & Quick Spin Button */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-surface/80 border border-white/10 px-3 py-1.5 text-xs text-muted">
            <UserCheck className="w-4 h-4 text-secondary" />
            <select
              value={selectedAgentId}
              onChange={(e) => {
                setSelectedAgentId(e.target.value);
                store.setCurrentAgent(e.target.value);
              }}
              className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer"
            >
              {store.agents.map((a) => (
                <option key={a.id} value={a.id} className="bg-elevated text-white">
                  {a.name} ({store.teams.find((t) => t.id === a.teamId)?.name})
                </option>
              ))}
            </select>
          </div>

          <Link
            href="/spin"
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary px-5 py-2 font-heading text-xs font-bold text-white shadow-lg shadow-primary/25 hover:brightness-110 active:scale-95 transition-all"
          >
            <Sparkles className="w-4 h-4 text-gold" />
            <span>SPIN NOW ({credit?.available ?? 0})</span>
          </Link>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Approved Sales */}
        <div className="rounded-2xl border border-emerald-500/20 bg-[#0D1426]/90 p-5 glow-success backdrop-blur-md">
          <div className="flex items-center justify-between text-muted text-xs font-semibold mb-2">
            <span>APPROVED SALES</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="font-heading text-4xl font-black text-white">
            <AnimatedCounter value={approvedSalesToday.length} />
          </div>
          <span className="text-[11px] font-mono text-emerald-400 block mt-1">
            Target: {targetGoal} sales
          </span>
        </div>

        {/* Available Spins */}
        <div className="rounded-2xl border border-primary/20 bg-[#0D1426]/90 p-5 glow-primary backdrop-blur-md">
          <div className="flex items-center justify-between text-muted text-xs font-semibold mb-2">
            <span>UNLOCKED SPINS</span>
            <Disc3 className="w-4 h-4 text-primary" />
          </div>
          <div className="font-heading text-4xl font-black text-primary">
            <AnimatedCounter value={credit?.available ?? 0} />
          </div>
          <span className="text-[11px] font-mono text-secondary block mt-1">
            {credit?.used ?? 0} used so far
          </span>
        </div>

        {/* Current Arena Rank */}
        <div className="rounded-2xl border border-gold/20 bg-[#0D1426]/90 p-5 glow-gold backdrop-blur-md">
          <div className="flex items-center justify-between text-muted text-xs font-semibold mb-2">
            <span>FLOOR RANK</span>
            <Trophy className="w-4 h-4 text-gold" />
          </div>
          <div className="font-heading text-4xl font-black text-gold">
            #{rank}
          </div>
          <span className="text-[11px] font-mono text-muted block mt-1">
            Across {store.agents.length} agents
          </span>
        </div>

        {/* Daily Target Completion */}
        <div className="rounded-2xl border border-secondary/20 bg-[#0D1426]/90 p-5 glow-cyan backdrop-blur-md">
          <div className="flex items-center justify-between text-muted text-xs font-semibold mb-2">
            <span>TARGET STATUS</span>
            <Target className="w-4 h-4 text-secondary" />
          </div>
          <div className="font-heading text-4xl font-black text-secondary">
            {progressPercent}%
          </div>
          <div className="w-full bg-white/10 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-secondary rounded-full transition-all duration-700"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Milestone Progress Banner */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-surface via-[#0D1426] to-surface p-6 backdrop-blur-md flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/15 text-gold border border-gold/30">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-heading text-base font-bold text-white">
              Next Reward Spin Milestone
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">
              Only <span className="text-gold font-bold">{salesToNextSpin} more approved sale{salesToNextSpin === 1 ? "" : "s"}</span> needed to unlock another spin on the 3D prize wheel!
            </p>
          </div>
        </div>

        <Link
          href="/spin"
          className="px-6 py-2.5 rounded-xl bg-surface border border-white/10 text-white font-heading text-xs font-bold hover:bg-surface-hover transition-all flex items-center gap-2"
        >
          <span>Go to Spin Arena</span>
          <ChevronRight className="w-4 h-4 text-secondary" />
        </Link>
      </div>

      {/* Grid: Activity Timeline & Reward Vault History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Personal Sales Transactions */}
        <div className="lg:col-span-6 rounded-3xl border border-white/10 bg-[#0D1426]/90 p-6 backdrop-blur-md">
          <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
            <div className="flex items-center gap-2 font-heading font-bold text-base text-white">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>TODAY&apos;S APPROVED TRANSACTIONS</span>
            </div>
            <span className="text-xs font-mono text-muted">
              {approvedSalesToday.length} deals
            </span>
          </div>

          {approvedSalesToday.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted">
              No approved sales yet today. Head over to the Demo Cockpit to simulate deals!
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {approvedSalesToday.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-surface/40 border border-white/5 hover:border-white/10 transition-colors"
                >
                  <div>
                    <span className="font-semibold text-white text-sm block">
                      {s.product}
                    </span>
                    <span className="text-[10px] font-mono text-muted">
                      {s.approvedAt ? <TimeAgo iso={s.approvedAt} /> : "just now"}
                    </span>
                  </div>
                  <div className="font-heading font-bold text-emerald-400 text-sm">
                    +${s.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Won Rewards History */}
        <div className="lg:col-span-6 rounded-3xl border border-white/10 bg-[#0D1426]/90 p-6 backdrop-blur-md">
          <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
            <div className="flex items-center gap-2 font-heading font-bold text-base text-white">
              <Gift className="w-4 h-4 text-gold" />
              <span>WON PRIZE VAULT</span>
            </div>
            <span className="text-xs font-mono text-muted">
              {personalSpins.length} unlocked
            </span>
          </div>

          {personalSpins.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted">
              No prizes won yet. Use available spin credits in the Spin Arena!
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {personalSpins.map((sp) => (
                <div
                  key={sp.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-surface/40 border border-white/5 hover:border-gold/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: sp.rewardColor }}
                    />
                    <div>
                      <span className="font-heading font-bold text-white text-sm block">
                        {sp.rewardTitle}
                      </span>
                      <span className="text-[10px] font-mono text-muted">
                        Won <TimeAgo iso={sp.createdAt} />
                      </span>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-mono font-bold">
                    {sp.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
