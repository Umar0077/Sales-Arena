"use client";

import { motion } from "motion/react";
import type { Sale, Agent, Team, Campaign } from "@/types";
import { Sparkles, TrendingUp, Flame, CheckCircle, Disc3 } from "lucide-react";

interface BroadcastHeroProps {
  latestSale: Sale | null;
  agent: Agent | null;
  team: Team | null;
  campaign: Campaign | null;
  topAgent: { agent: Agent; sales: number; team?: Team } | null;
  completionRate: number;
}

export function BroadcastHero({
  latestSale,
  agent,
  team,
  campaign,
  topAgent,
  completionRate,
}: BroadcastHeroProps) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-[#0D1426] via-[#121C32] to-[#070B16] p-6 lg:p-8 shadow-2xl">
      {/* Dynamic ambient background glows */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-secondary/15 blur-3xl" />

      {/* Top Banner Tag */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 border-b border-white/5 pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-heading text-xs font-bold tracking-widest text-emerald-400 uppercase">
            LIVE BROADCAST STADIUM
          </span>
          <span className="text-xs text-muted">·</span>
          <span className="text-xs font-mono text-secondary">
            CAMPAIGN FLOOR ACTIVE
          </span>
        </div>

        {/* Status only: spins open automatically when an agent hits their target. */}
        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gold/15 border border-gold/30 text-gold text-xs font-bold">
          <Disc3 className="w-3.5 h-3.5" />
          <span>SPIN REWARDS ACTIVE</span>
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Left: Latest Approval Spotlight */}
        <div className="lg:col-span-7 flex flex-col justify-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-surface border border-white/5 w-fit mb-3">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs text-muted font-medium">LATEST APPROVED TRANSACTION</span>
          </div>

          {latestSale && agent ? (
            <motion.div
              key={latestSale.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-3"
            >
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight">
                {agent.name}
              </h2>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-md border border-emerald-400/20">
                  +${latestSale.value} {latestSale.product}
                </span>
                {team && (
                  <span
                    className="font-medium px-2.5 py-1 rounded-md"
                    style={{
                      backgroundColor: `${team.color}20`,
                      color: team.color,
                      border: `1px solid ${team.color}40`,
                    }}
                  >
                    Team {team.name}
                  </span>
                )}
                {campaign && (
                  <span className="text-text-secondary bg-surface px-2.5 py-1 rounded-md border border-white/5">
                    {campaign.name}
                  </span>
                )}
              </div>

              <p className="text-text-muted text-xs font-mono pt-1">
                Approved today · Synced with live dialer event bus
              </p>
            </motion.div>
          ) : (
            <div className="py-6">
              <h2 className="font-heading text-3xl font-bold text-white">
                Arena Floor Ready
              </h2>
              <p className="text-muted text-sm mt-1">
                Awaiting incoming dialer sales approvals. Use the Demo Cockpit to simulate live calls.
              </p>
            </div>
          )}
        </div>

        {/* Right: Top Performer Podium Card */}
        <div className="lg:col-span-5">
          {topAgent ? (
            <div className="rounded-2xl border border-gold/30 bg-gradient-to-b from-[#1A2945]/70 to-[#0D1426]/90 p-5 glow-gold backdrop-blur-md">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-gold text-xs font-bold tracking-wider uppercase font-heading">
                  <Flame className="w-4 h-4 fill-gold" />
                  <span>CURRENT #1 MVP</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-gold/20 text-gold text-[10px] font-mono font-bold">
                  PODIUM LEADER
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl font-heading text-xl font-black text-white shadow-lg"
                  style={{
                    backgroundColor: topAgent.team?.color || "#7568FF",
                  }}
                >
                  {topAgent.agent.initials}
                </div>
                <div>
                  <div className="font-heading text-lg font-bold text-white">
                    {topAgent.agent.name}
                  </div>
                  <div className="text-xs text-text-secondary">
                    {topAgent.team?.name || "Titans"} · {topAgent.agent.title}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                <span className="text-xs text-muted">Approved Sales Today:</span>
                <span className="font-heading text-2xl font-black text-gold">
                  {topAgent.sales}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
