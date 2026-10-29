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
import { TopPerformersPodium } from "@/components/arena/TopPerformersPodium";
import { useCloserRows } from "@/components/arena/LiveLeaderboard";
import { ScreenTitle } from "./parts";
import { useRewardsStore, programFor } from "@/store/rewards-store";
import { formatReward } from "@/lib/rewards/engine";
import { usePeriodInfo } from "@/components/arena/LiveLeaderboard";

/**
 * Live floor: KPIs, latest sale, feeds, and today's leaderboard on the right.
 * "spin" is the original Spin & Win screen. "daily" adds the daily bonus heading and
 * puts TOP 3 WEEKLY PERFORMERS where the feeds were, moving the feeds further down.
 */
export function FloorScreen({ variant }: { variant: "spin" | "daily" }) {
  const daily = variant === "daily";
  const dataSourceMode = useArenaStore((s) => s.dataSourceMode);
  const dayRows = useCloserRows("day", 1);
  const weekRows = useCloserRows("week", 3);
  const dayMetrics = useArenaStore((s) => s.periodMetrics?.day);
  const weekMetrics = useArenaStore((s) => s.periodMetrics?.week);
  const weekInfo = usePeriodInfo("week");
  const weekDateLabel = weekMetrics?.dateRange?.detailedLabel || weekInfo.label;
  const programs = useRewardsStore((s) => s.programs);
  const awards = useRewardsStore((s) => s.awards);
  const currency = useSettingsStore((s) => s.currencyLabel);
  const dayInfo = usePeriodInfo("day");
  const program = programFor(programs, "daily");
  const todayAwards = useMemo(() => awards.filter((a) => a.kind === "daily" && a.periodKey === dayInfo.key), [awards, dayInfo.key]);
  const todayTotal = todayAwards.reduce((t, a) => t + a.amount, 0);
  const concurrent = useSettingsStore((s) => s.programsConcurrent);
  const defaultMode = useSettingsStore((s) => s.defaultArenaMode);
  const dailyAllowed = concurrent || defaultMode === "daily";
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
    if (dataSourceMode === "production") {
      const daySales = dayMetrics?.sales ?? [];
      const prodSales = daySales.filter((s) => s.source === "safequote-api" && s.status === "approved");
      return prodSales[prodSales.length - 1] ?? null;
    }
    for (let i = sales.length - 1; i >= 0; i--) if (sales[i].status === "approved") return sales[i];
    return null;
  }, [sales, dayMetrics?.sales, dataSourceMode]);
  const latestAgent = useMemo(() => {
    if (!latestSale) return null;
    const found = agents.find((a) => a.id === latestSale.agentId);
    if (found) return found;
    if (latestSale.closerName) {
      return {
        id: latestSale.agentId,
        name: latestSale.closerName,
        initials: latestSale.closerName.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "CL",
        teamId: "team_titans",
        campaignId: "cmp_fiber",
        active: true,
        title: "Top Closer",
        hue: 240,
        joinedAt: new Date().toISOString(),
      };
    }
    return null;
  }, [latestSale, agents]);
  const latestTeam = latestSale ? teams.find((t) => t.id === latestSale.teamId) ?? null : null;
  const latestCampaign = latestSale ? campaigns.find((c) => c.id === latestSale.campaignId) ?? null : null;

  const realDailySalesEvents = useMemo(() => {
    const daySales = dayMetrics?.sales ?? [];
    return daySales
      .filter((s) => s.source === "safequote-api" && s.status === "approved")
      .map((sale) => {
        const policyParts = [
          sale.carrier,
          sale.state ? `(${sale.state})` : null,
          sale.coverage ? `$${Number(sale.coverage).toLocaleString()} cov.` : null,
        ].filter(Boolean);

        const policyStr = policyParts.length > 0 ? policyParts.join(" ") : sale.product;
        const premiumStr = sale.value > 0 ? ` · $${sale.value.toFixed(2)} premium` : "";
        const closerName = sale.closerName || sale.closerCode || "Closer";

        return {
          id: `act_${sale.id}`,
          type: "sale-approved" as const,
          message: `${closerName} closed ${policyStr}${premiumStr}`,
          createdAt: sale.approvedAt || sale.createdAt,
          agentId: sale.agentId,
        };
      });
  }, [dayMetrics?.sales]);

  const realDailyAchievementsEvents = useMemo(() => {
    return todayAwards.map((award) => ({
      id: `act_award_${award.id}`,
      type: "milestone" as const,
      message: `${award.agentName} earned ${currency} ${award.amount.toLocaleString()} ${award.programName}!`,
      createdAt: award.createdAt,
      agentId: award.agentId,
    }));
  }, [todayAwards, currency]);

  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-[1920px] gap-5 p-4 lg:p-6",
        showBoard && "xl:grid-cols-[minmax(0,1fr)_440px] 2xl:grid-cols-[minmax(0,1fr)_540px]",
      )}
    >
      <div className="min-w-0 space-y-5">
        {daily && program && (
          <ScreenTitle
            eyebrow="DAILY BONUS ARENA"
            title="Today's Bonus Floor"
            accent={program.accent}
            rule={program.enabled && dailyAllowed ? `${program.salesRequired} validated sale${program.salesRequired > 1 ? "s" : ""} = ${formatReward(program.amount, program.prizeLabel, currency)}` : undefined}
            inactiveNote={
              !program.enabled ? "Daily bonus paused" : !dailyAllowed ? "Daily bonus not running (another screen is the default)" : `${currency} ${todayTotal.toLocaleString("en-US")} awarded today`
            }
          />
        )}
        {showKpis && <KpiBar stats={stats} />}

        {showHero && (
          <BroadcastHero
            latestSale={latestSale}
            agent={latestAgent}
            team={latestTeam}
            campaign={latestCampaign}
            topAgent={
              (dayRows[0] ?? leader)
                ? {
                    agent: (dayRows[0] ?? leader)!.agent,
                    sales: (dayRows[0] ?? leader)!.counts.validated,
                    team: teams.find((t) => t.id === (dayRows[0] ?? leader)!.teamId),
                  }
                : null
            }
            completionRate={stats.completion}
          />
        )}

        {daily && (
          <TopPerformersPodium
            rows={weekRows}
            title="TOP 3 WEEKLY PERFORMERS"
            subtitle={`${weekDateLabel} · ranked by validated sales, then submitted leads`}
            testId="top3-weekly"
          />
        )}

        {showActivity && (
          <div className="grid gap-5 md:grid-cols-2">
            <ArenaLiveActivity
              events={dataSourceMode === "production" ? realDailySalesEvents : activity}
              title="LATEST SALES"
              badge="STREAMING"
              types={["sale-approved", "sale-pending"]}
              limit={10}
              emptyText="No validated sales recorded today yet."
            />
            <ArenaLiveActivity
              events={dataSourceMode === "production" ? realDailyAchievementsEvents : activity}
              title="ACHIEVEMENTS & SPINS"
              badge="UNLOCKS"
              types={["spin-unlocked", "spin-completed", "milestone", "top-performer", "team-target", "special", "bonus-awarded"]}
              limit={10}
              emptyText="No daily achievements recorded yet."
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
