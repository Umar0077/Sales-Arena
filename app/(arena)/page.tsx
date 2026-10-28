"use client";

import { useMemo } from "react";
import { useArenaStore, pickData } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { computeArenaStatistics } from "@/features/sales/stats";
import { rankClosers } from "@/features/sales/leads";
import { KpiBar } from "@/components/arena/KpiBar";
import { BroadcastHero } from "@/components/arena/BroadcastHero";
import { ArenaLiveActivity } from "@/components/arena/ArenaLiveActivity";
import { LiveLeaderboard } from "@/components/arena/LiveLeaderboard";
import { cn } from "@/lib/utils";

/** Public Live Arena (TV display): live floor on the left, leaderboard on the right. */
export default function LiveArenaPage() {
  const sales = useArenaStore((s) => s.sales);
  const agents = useArenaStore((s) => s.agents);
  const teams = useArenaStore((s) => s.teams);
  const campaigns = useArenaStore((s) => s.campaigns);
  const spins = useArenaStore((s) => s.spins);
  const targetRules = useArenaStore((s) => s.targetRules);
  const bonusCredits = useArenaStore((s) => s.bonusCredits);
  const activity = useArenaStore((s) => s.activity);

  const showKpis = useSettingsStore((s) => s.showKpis);
  const showHero = useSettingsStore((s) => s.showHero);
  const showActivity = useSettingsStore((s) => s.showActivity);
  const showBoard = useSettingsStore((s) => s.leaderboardVisible);

  const { stats, leader } = useMemo(() => {
    const data = pickData(useArenaStore.getState());
    return {
      stats: computeArenaStatistics(data),
      // Same ranking as the leaderboard: validated sales, then submitted leads.
      leader: rankClosers(data, { limit: 1 })[0] ?? null,
    };
    // Recompute whenever any of the data slices change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, agents, teams, spins, targetRules, bonusCredits]);

  const latestSale = useMemo(() => {
    for (let i = sales.length - 1; i >= 0; i--) if (sales[i].status === "approved") return sales[i];
    return null;
  }, [sales]);
  const latestAgent = latestSale ? agents.find((a) => a.id === latestSale.agentId) ?? null : null;
  const latestTeam = latestSale ? teams.find((t) => t.id === latestSale.teamId) ?? null : null;
  const latestCampaign = latestSale ? campaigns.find((c) => c.id === latestSale.campaignId) ?? null : null;

  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-[1920px] gap-5 p-4 lg:p-6",
        showBoard && "xl:grid-cols-[minmax(0,1fr)_440px] 2xl:grid-cols-[minmax(0,1fr)_540px]",
      )}
    >
      <div className="min-w-0 space-y-5">
        {showKpis && <KpiBar stats={stats} />}

        {showHero && (
          <BroadcastHero
            latestSale={latestSale}
            agent={latestAgent}
            team={latestTeam}
            campaign={latestCampaign}
            topAgent={leader ? { agent: leader.agent, sales: leader.counts.validated, team: teams.find((t) => t.id === leader.teamId) } : null}
            completionRate={stats.completion}
          />
        )}

        {showActivity && (
          <div className="grid gap-5 md:grid-cols-2">
            <ArenaLiveActivity
              events={activity}
              title="LATEST SALES"
              badge="STREAMING"
              types={["sale-approved", "sale-pending"]}
              limit={10}
            />
            <ArenaLiveActivity
              events={activity}
              title="ACHIEVEMENTS & SPINS"
              badge="UNLOCKS"
              types={["spin-unlocked", "spin-completed", "milestone", "top-performer", "team-target", "special"]}
              limit={10}
              emptyText="Spin unlocks and wins will appear here."
            />
          </div>
        )}
      </div>

      {showBoard && (
        <aside className="min-w-0 xl:sticky xl:top-20 xl:h-[calc(100vh-6.5rem)] min-h-[560px]">
          <LiveLeaderboard />
        </aside>
      )}
    </div>
  );
}
