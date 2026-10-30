"use client";

import type { LeaderboardEntry } from "@/types";
import { Trophy, Medal, ChevronUp, ChevronDown, Minus, Crown } from "lucide-react";
import Link from "next/link";

export function ArenaLeaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  const topList = entries.slice(0, 7);

  return (
    <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 p-5 lg:p-6 backdrop-blur-xl flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-gold" />
          <h3 className="font-heading text-base font-bold text-white tracking-tight">
            TOP PERFORMERS
          </h3>
        </div>
        <Link
          href="/leaderboard"
          className="text-xs text-secondary hover:text-white transition-colors font-semibold"
        >
          View All →
        </Link>
      </div>

      <div className="space-y-2.5 flex-1">
        {topList.map((entry, idx) => {
          const isFirst = idx === 0;
          const isSecond = idx === 1;
          const isThird = idx === 2;

          return (
            <div
              key={entry.agent.id}
              className={`relative flex items-center justify-between p-3 rounded-2xl border transition-all ${
                isFirst
                  ? "bg-gradient-to-r from-gold/15 to-transparent border-gold/40 glow-gold"
                  : isSecond
                  ? "bg-white/5 border-slate-300/30"
                  : isThird
                  ? "bg-white/5 border-amber-600/30"
                  : "bg-surface/50 border-white/5 hover:border-white/15"
              }`}
            >
              {/* Rank and Avatar */}
              <div className="flex items-center gap-3">
                <div className="w-6 flex items-center justify-center font-heading font-black text-sm">
                  {isFirst ? (
                    <Crown className="w-5 h-5 text-gold fill-gold" />
                  ) : isSecond ? (
                    <Medal className="w-5 h-5 text-slate-300" />
                  ) : isThird ? (
                    <Medal className="w-5 h-5 text-amber-500" />
                  ) : (
                    <span className="text-muted font-mono">{idx + 1}</span>
                  )}
                </div>

                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-heading text-xs font-bold text-white"
                  style={{
                    backgroundColor: entry.team?.color || "#7568FF",
                  }}
                >
                  {entry.agent.initials}
                </div>

                <div className="min-w-0">
                  <div className="font-heading text-sm font-bold text-white truncate flex items-center gap-2">
                    <span>{entry.agent.name}</span>
                    {entry.movement > 0 && (
                      <span className="flex items-center text-[10px] text-emerald-400 font-mono">
                        <ChevronUp className="w-3 h-3" />+{entry.movement}
                      </span>
                    )}
                    {entry.movement < 0 && (
                      <span className="flex items-center text-[10px] text-rose-400 font-mono">
                        <ChevronDown className="w-3 h-3" />
                        {entry.movement}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-text-muted truncate">
                    {entry.team?.name ?? "Final Expense"}
                  </div>
                </div>
              </div>

              {/* Sales Score */}
              <div className="text-right">
                <div className={`font-heading text-lg font-black ${isFirst ? "text-gold" : "text-white"}`}>
                  {entry.sales}
                </div>
                <div className="text-[10px] font-mono text-muted">
                  sales today
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
