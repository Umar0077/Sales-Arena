"use client";

import { useEffect, useMemo, useRef } from "react";
import { motion, LayoutGroup } from "motion/react";
import { Trophy, Crown } from "lucide-react";
import { useArenaStore } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { rankClosers, type CloserRow } from "@/features/sales/leads";
import { cn } from "@/lib/utils";

const MEDALS = [
  { bg: "linear-gradient(135deg, #FFE08A, #E8A317)", ring: "rgba(255,200,87,0.55)", glow: "rgba(255,200,87,0.35)", text: "#2A1C00" },
  { bg: "linear-gradient(135deg, #F1F4FA, #9AA4B6)", ring: "rgba(215,222,234,0.45)", glow: "rgba(215,222,234,0.22)", text: "#1B2130" },
  { bg: "linear-gradient(135deg, #F2B27D, #B4652E)", ring: "rgba(224,145,90,0.5)", glow: "rgba(224,145,90,0.25)", text: "#2B1406" },
];

/** Bar colour by closed rate: green when strong, amber in the middle, rose when low. */
function rateColor(rate: number): string {
  if (rate >= 60) return "linear-gradient(90deg, #36E0B5, #7BE38A)";
  if (rate >= 35) return "linear-gradient(90deg, #FFC857, #FFB347)";
  return "linear-gradient(90deg, #FF647C, #FF8FA3)";
}

/** Today's top closers, using the admin's leaderboard settings. */
export function useCloserRows(): CloserRow[] {
  const sales = useArenaStore((s) => s.sales);
  const agents = useArenaStore((s) => s.agents);
  const count = useSettingsStore((s) => s.leaderboardCount);
  const teamId = useSettingsStore((s) => s.leaderboardTeamId);
  const campaignId = useSettingsStore((s) => s.leaderboardCampaignId);
  return useMemo(
    () => rankClosers({ agents, sales }, { teamId, campaignId, limit: Math.max(3, Math.min(15, count)) }),
    [agents, sales, count, teamId, campaignId],
  );
}

export function LiveLeaderboard() {
  const rows = useCloserRows();
  const animate = useSettingsStore((s) => s.leaderboardAnimations);
  const size = useSettingsStore((s) => s.leaderboardSize);
  const style = useSettingsStore((s) => s.topPerformerStyle);
  const count = useSettingsStore((s) => s.leaderboardCount);
  const medals = style !== "minimal";
  const compact = size === "compact";

  // Remember previous ranks to flash closers who just moved up.
  const prevRanks = useRef(new Map<string, number>());
  const climbed = new Set<string>();
  for (const r of rows) {
    const before = prevRanks.current.get(r.agent.id);
    if (before !== undefined && r.rank < before) climbed.add(r.agent.id);
  }
  useEffect(() => {
    prevRanks.current = new Map(rows.map((r) => [r.agent.id, r.rank]));
  }, [rows]);

  // Phones: rank · name (with counts underneath) · rate. Wider: all five columns.
  const cols =
    "grid-cols-[2rem_minmax(0,1fr)_5rem] gap-x-2.5 sm:grid-cols-[2.25rem_minmax(0,1fr)_3.75rem_4.5rem_6rem] sm:gap-x-3";

  return (
    <section
      aria-label="Leaderboard"
      className="flex h-full flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0B1122]/85 shadow-[0_30px_80px_-30px_rgba(117,104,255,0.45)] backdrop-blur-xl"
    >
      {/* Header */}
      <header className="relative flex items-center justify-between gap-3 overflow-hidden bg-gradient-to-r from-[#3B22B8] via-[#5136D9] to-[#3A2C8E] px-5 py-4">
        <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex min-w-0 items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/20 bg-white/10">
            <Trophy className="h-5 w-5 text-gold drop-shadow-[0_0_8px_rgba(255,200,87,0.6)]" />
          </div>
          <div className="min-w-0">
            <h2 className="font-heading text-base font-extrabold leading-tight text-white sm:truncate sm:text-lg">Top Performer Leaderboard</h2>
            <p className="truncate text-xs text-white/75">Top {count} closers by validated leads, then submissions</p>
          </div>
        </div>
        <span
          role="status"
          aria-label="Showing today's performance"
          className="relative shrink-0 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-xs font-bold text-white"
        >
          Today
        </span>
      </header>

      {/* Column headings */}
      <div className={cn("mx-3 mt-3 grid items-end rounded-xl bg-white/[0.05] px-3 py-2.5 text-[10px] font-bold uppercase leading-tight tracking-[0.08em] text-text-secondary", cols)}>
        <span>Rank</span>
        <span>Closer Name</span>
        <span className="hidden text-center sm:block">Submitted Leads</span>
        <span className="hidden text-center sm:block">Validated</span>
        <span>Policy Closed Rate</span>
      </div>

      <LayoutGroup>
        <ol className={cn("min-h-0 flex-1 overflow-y-auto px-3 py-2.5", compact ? "space-y-1.5" : "space-y-2")} data-testid="closer-rows">
          {rows.map((r) => {
            const medal = medals && r.rank <= 3 ? MEDALS[r.rank - 1] : null;
            const rate = Math.round(r.rate);
            return (
              <motion.li
                key={r.agent.id}
                layout={animate ? "position" : false}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
                data-agent={r.agent.id}
                className={cn(
                  "grid items-center rounded-xl border bg-white/[0.025] px-3",
                  cols,
                  compact ? "py-2" : "py-2.5",
                  !medal && "border-white/[0.06]",
                  climbed.has(r.agent.id) && "lb-climb",
                )}
                style={medal ? { borderColor: medal.ring, boxShadow: r.rank === 1 ? `0 0 28px -12px ${medal.glow}` : undefined } : undefined}
              >
                {/* Rank */}
                <span
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-full font-heading text-sm font-extrabold tabular",
                    !medal && "bg-white/[0.06] text-text-secondary",
                  )}
                  style={medal ? { background: medal.bg, color: medal.text, boxShadow: `0 0 14px ${medal.glow}` } : undefined}
                >
                  {r.rank}
                </span>

                {/* Closer */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-bold text-white" title={r.agent.name}>{r.agent.name}</span>
                    {r.rank === 1 && medals && <Crown className="h-4 w-4 shrink-0 fill-gold/30 text-gold" aria-label="Top closer" />}
                  </div>
                  <div className="truncate text-[11px] font-medium text-text-muted tabular">{r.code}</div>
                  <div className="mt-0.5 text-[11px] text-text-secondary tabular sm:hidden">
                    {r.counts.submitted} submitted · <span className="text-emerald-300">{r.counts.validated} validated</span>
                  </div>
                </div>

                {/* Submitted / Validated */}
                <span className="hidden text-center font-heading text-base font-bold text-white tabular sm:block" data-col="submitted">{r.counts.submitted}</span>
                <span className="hidden text-center font-heading text-base font-semibold text-emerald-300 tabular sm:block" data-col="validated">{r.counts.validated}</span>

                {/* Closed rate */}
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white tabular" data-col="rate">{rate}%</div>
                  <div
                    className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"
                    role="progressbar"
                    aria-valuenow={rate}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${r.agent.name} closed rate`}
                  >
                    <div
                      className="h-full rounded-full transition-[width] duration-700 ease-out"
                      style={{ width: `${Math.min(100, rate)}%`, background: rateColor(rate) }}
                    />
                  </div>
                </div>
              </motion.li>
            );
          })}
          {rows.length === 0 && <li className="py-10 text-center text-sm text-text-muted">No leads submitted yet today.</li>}
        </ol>
      </LayoutGroup>
    </section>
  );
}
