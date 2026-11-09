"use client";

import { memo } from "react";
import { motion } from "motion/react";
import type { Sale, Agent, Team, Campaign } from "@/shared/types";
import { Flame, Disc3, Crown, Radio } from "lucide-react";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { useArenaStore } from "@/frontend/stores/arena-store";

interface BroadcastHeroProps {
  latestSale: Sale | null;
  agent: Agent | null;
  team: Team | null;
  campaign: Campaign | null;
  topAgent: { agent: Agent; sales: number; team?: Team } | null;
  completionRate?: number;
}

/** Daily Arena hero: the live stadium panel and the current #1. Presentation only (same props and data as before). */
export const BroadcastHero = memo(function BroadcastHero({
  latestSale,
  agent,
  team,
  campaign,
  topAgent,
  completionRate: _completionRate,
}: BroadcastHeroProps) {
  const spinOn = useSettingsStore((s) => s.spinFeatureEnabled);
  const liveMode = useArenaStore((s) => s.liveMode);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-[#101A33] via-[#121B36] to-[#080D1C] p-4 shadow-[0_30px_70px_-40px_rgba(117,104,255,0.7)] lg:p-5" data-testid="broadcast-hero">
      {/* Ambient light */}
      <div className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 right-[20%] h-64 w-96 rounded-full bg-gold/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* Top banner */}
      <div className="relative mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/[0.07] px-3 py-1">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <span className="font-heading text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">LIVE BROADCAST STADIUM</span>
        </div>

        {/* Shown only while Spin rewards are switched on in Admin. */}
        {spinOn && (
          <span className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/15 px-3 py-1 text-xs font-bold text-gold">
            <Disc3 className="h-3.5 w-3.5" />
            <span>SPIN REWARDS ACTIVE</span>
          </span>
        )}
      </div>

      <div className="relative grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        {/* Left: the stadium floor */}
        <div className="flex min-w-0 flex-col justify-center rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.035] to-transparent px-5 py-4 lg:col-span-7">
          {latestSale && agent ? (
            <motion.div key={latestSale.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-3">
              <h2 className="font-heading text-3xl font-black tracking-tight text-white xl:text-4xl 2xl:text-5xl">{agent.name}</h2>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 font-semibold text-emerald-400">
                  +${latestSale.value} {latestSale.product}
                </span>
                {team && (
                  <span
                    className="rounded-md px-2.5 py-1 font-medium"
                    style={{
                      backgroundColor: `${team.color}20`,
                      color: team.color,
                      border: `1px solid ${team.color}40`,
                    }}
                  >
                    Team {team.name}
                  </span>
                )}
                {campaign && <span className="rounded-md border border-white/5 bg-surface px-2.5 py-1 text-text-secondary">{campaign.name}</span>}
              </div>

              <p className="pt-1 font-mono text-xs text-text-muted">Approved today · {liveMode ? "Validated by Safe Quote" : "Demo data"}</p>
            </motion.div>
          ) : (
            <div className="flex items-center gap-5" data-testid="arena-floor-ready">
              <div className="ac-radar grid place-items-center" aria-hidden>
                <span />
                <span />
                <span />
                <div className="relative grid h-12 w-12 place-items-center rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-400/20 to-secondary/10 shadow-[0_0_30px_-8px_rgba(54,224,181,0.6)]">
                  <Radio className="h-6 w-6 text-emerald-300" />
                </div>
              </div>
              <div className="min-w-0">
                <h2 className="font-heading text-3xl font-black tracking-tight text-white xl:text-4xl">Arena Floor Ready</h2>
                <p className="mt-1 text-sm text-text-secondary">Awaiting incoming validated sales from Safe Quote API.</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: the current #1 */}
        <div className="lg:col-span-5">
          {topAgent ? (
            <div
              className="relative h-full overflow-hidden rounded-2xl bg-gradient-to-b from-[#2A2210]/80 via-[#151A30]/95 to-[#0B1022] px-5 py-4 shadow-[0_0_60px_-22px_rgba(255,200,87,0.65)]"
              data-testid="hero-mvp"
            >
              <span className="ac-champ-ring" aria-hidden />
              <span className="ac-champ-sheen" aria-hidden />
              <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-gold/15 blur-3xl" />

              <div className="relative mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-heading text-xs font-bold uppercase tracking-[0.18em] text-gold">
                  <Flame className="h-4 w-4 fill-gold" />
                  <span>CURRENT #1 MVP</span>
                </div>
                <span className="rounded-full border border-gold/30 bg-gold/15 px-2.5 py-0.5 font-mono text-[10px] font-bold text-gold">PODIUM LEADER</span>
              </div>

              <div className="relative flex items-center gap-4">
                <div className="relative shrink-0">
                  <div
                    className="flex h-16 w-16 items-center justify-center rounded-2xl font-heading text-2xl font-black text-white shadow-lg ring-2 ring-gold/60 ring-offset-2 ring-offset-[#151A30]"
                    style={{ backgroundColor: topAgent.team?.color || "#7568FF" }}
                  >
                    {topAgent.agent.initials}
                  </div>
                  <Crown className="absolute -right-2 -top-3 h-5 w-5 rotate-12 fill-gold/40 text-gold drop-shadow-[0_0_8px_rgba(255,200,87,0.8)]" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-heading text-xl font-extrabold text-white xl:text-2xl" title={topAgent.agent.name}>
                    {topAgent.agent.name}
                  </div>
                  <div className="truncate text-xs text-text-secondary">
                    {topAgent.agent.userCode ? `${topAgent.agent.userCode} · ` : ""}
                    {topAgent.sales > 0 ? "#1 today by validated sales" : "Leading today on submitted leads"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-heading text-4xl font-black leading-none text-gold tabular drop-shadow-[0_0_14px_rgba(255,200,87,0.45)] xl:text-5xl">{topAgent.sales}</div>
                </div>
              </div>

              <div className="relative mt-3 flex items-center justify-between border-t border-gold/15 pt-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Approved Sales Today</span>
                <span className="h-1 w-24 rounded-full bg-gradient-to-r from-gold/70 to-transparent" aria-hidden />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
