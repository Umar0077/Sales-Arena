"use client";

import { useMemo } from "react";
import { BadgeCheck, Target, Send, Percent, Gift, Users } from "lucide-react";
import { useArenaStore } from "@/frontend/stores/arena-store";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { useRewardsStore, programFor } from "@/frontend/stores/rewards-store";
import { periodLeadCounts, closedRate } from "@/shared/sales/leads";
import { addCredits } from "@/shared/sales/weighting";
import { LiveLeaderboard, useCloserRows, usePeriodInfo } from "@/frontend/components/arena/LiveLeaderboard";
import { TopPerformersPodium } from "@/frontend/components/arena/TopPerformersPodium";
import { ArenaLiveActivity } from "@/frontend/components/arena/ArenaLiveActivity";
import { ScreenTitle, StatGrid, AwardFeed } from "./parts";
import { cn } from "@/shared/utils";
import { useLiveStore } from "@/frontend/stores/live-store";
import { targetProgress, formatPercent } from "@/shared/live/targets";

const CONFIG = {
  weekly: { period: "week" as const, eyebrow: "WEEKLY BONUS ARENA", title: "This Week's Race", word: "this week", targetKey: "weeklyFloorTarget" as const },
  monthly: { period: "month" as const, eyebrow: "MONTHLY BONUS ARENA", title: "This Month's Championship", word: "this month", targetKey: "monthlyFloorTarget" as const },
};

/** Weekly or Monthly arena. Every number comes from the shared lead data for the period. */
export function PeriodScreen({ kind }: { kind: "weekly" | "monthly" }) {
  const cfg = CONFIG[kind];
  const dataSourceMode = useArenaStore((s) => s.dataSourceMode);
  const periodMetrics = useArenaStore((s) => s.periodMetrics?.[cfg.period]);
  const sales = useArenaStore((s) => s.sales);
  const agents = useArenaStore((s) => s.agents);
  const history = useArenaStore((s) => s.history);
  const historySubmitted = useArenaStore((s) => s.historySubmitted);
  const activity = useArenaStore((s) => s.activity);
  const programs = useRewardsStore((s) => s.programs);
  const awards = useRewardsStore((s) => s.awards);
  const currency = useSettingsStore((s) => s.currencyLabel);
  const demoFloorTarget = useSettingsStore((s) => s[cfg.targetKey]);
  const liveMode = useArenaStore((s) => s.liveMode);
  const liveTarget = useLiveStore((s) => s.targets[cfg.period]);
  const earned = useLiveStore((s) => s.awardSummary?.[kind] ?? null);
  const earnedStatus = useLiveStore((s) => s.awardSummaryStatus);
  // Live: the PostgreSQL target for this week/month (null = not set). Demo: the simulated floor target.
  const floorTarget = liveMode ? liveTarget : demoFloorTarget;
  const showBoard = useSettingsStore((s) => s.leaderboardVisible);
  const info = usePeriodInfo(cfg.period);
  const program = programFor(programs, kind);
  const rows = useCloserRows(cfg.period, 3);

  const view = useMemo(() => {
    const isProd = dataSourceMode === "production" && !!periodMetrics?.summary;

    let validated = 0;
    let submitted = 0;
    let closeRate = 0;

    if (isProd) {
      validated = periodMetrics.summary!.validated;
      submitted = periodMetrics.summary!.submitted;
      closeRate = periodMetrics.summary!.closeRate;
    } else {
      const counts = periodLeadCounts({ sales, history, historySubmitted }, info.daysBack);
      const active = new Set(agents.filter((a) => a.active).map((a) => a.id));
      counts.forEach((c, id) => {
        if (!active.has(id)) return;
        validated = addCredits(validated, c.validated);
        submitted += c.submitted;
      });
      closeRate = closedRate({ submitted, validated });
    }

    const periodAwards = awards.filter((a) => a.kind === kind && a.periodKey === info.key);
    const need = program?.salesRequired ?? 1;
    const qualified = new Set(periodAwards.map((a) => a.agentId)).size;
    const awardedIds = new Set(periodAwards.map((a) => a.agentId));

    let close: Array<{ name: string; need: number }> = [];
    if (isProd && periodMetrics?.closers?.length) {
      close = periodMetrics.closers
        .filter((r) => !awardedIds.has(r.agent.id))
        .map((r) => ({ name: r.agent.name, need: need - r.counts.validated }))
        .filter((c) => c.need > 0)
        .sort((x, y) => x.need - y.need)
        .slice(0, 3);
    } else {
      const counts = periodLeadCounts({ sales, history, historySubmitted }, info.daysBack);
      close = agents
        .filter((a) => a.active && !awardedIds.has(a.id))
        .map((a) => ({ name: a.name, need: need - (counts.get(a.id)?.validated ?? 0) }))
        .filter((c) => c.need > 0)
        .sort((x, y) => x.need - y.need)
        .slice(0, 3);
    }

    return {
      validated,
      submitted,
      closeRate,
      periodAwards,
      qualified,
      close,
      total: periodAwards.reduce((t, a) => t + a.amount, 0),
    };
  }, [dataSourceMode, periodMetrics, sales, history, historySubmitted, agents, awards, kind, info, program?.salesRequired]);

  const accent = program?.accent ?? "#22D3FF";
  const daysLeft = kind === "monthly" ? daysLeftInMonth(info.today) : 6 - info.daysBack;
  const dateRangeLabel = periodMetrics?.dateRange?.detailedLabel || info.label;

  const periodSales = periodMetrics?.sales ?? [];
  const realSalesEvents = useMemo(() => {
    return periodSales
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
          teamId: sale.teamId ?? null,
          simulated: false,
        };
      });
  }, [periodSales]);

  return (
    <div className={cn("mx-auto grid w-full max-w-[1920px] gap-5 p-4 lg:p-6", showBoard && "xl:grid-cols-[minmax(0,1fr)_440px] 2xl:grid-cols-[minmax(0,1fr)_540px]")}>
      <div className="min-w-0 space-y-5">
        <ScreenTitle
          eyebrow={cfg.eyebrow}
          title={cfg.title}
          accent={accent}
          inactiveNote={dateRangeLabel || `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
          tone={kind === "monthly" ? "championship" : undefined}
        />

        <StatGrid
          stats={[
            { label: `Validated ${cfg.word}`, value: view.validated, icon: BadgeCheck, accent: "#36E0B5", testId: "period-validated" },
            {
              label: `Target ${cfg.word}`,
              value: targetProgress(view.validated, floorTarget).target ?? 0,
              icon: Target,
              accent: "#22D3FF",
              format: targetProgress(view.validated, floorTarget).target === null ? () => "Not set" : undefined,
              progress: (targetProgress(view.validated, floorTarget).percent ?? 0) / 100,
              sub: (() => {
                const p = targetProgress(view.validated, floorTarget);
                return p.target === null ? "Set it in Admin → Targets" : `${formatPercent(p.percent)} reached · ${p.remaining} to go`;
              })(),
            },
            { label: "Submitted leads", value: view.submitted, icon: Send, accent: "#8B5CFF", testId: "period-submitted" },
            { label: "Closed rate", value: Math.round(view.closeRate), icon: Percent, accent: "#FFC857", format: (v) => `${Math.round(v)}%` },
            // Live: cash earned this period from PostgreSQL bonus_awards (not paid; cancelled/reversed excluded).
            liveMode
              ? {
                  label: "Bonuses earned",
                  value: earned?.earned ?? 0,
                  icon: Gift,
                  accent,
                  format: earned ? (v: number) => `${earned.currency} ${Math.round(v).toLocaleString("en-US")}` : () => (earnedStatus === "error" ? "Unavailable" : "…"),
                  sub: earned ? `${earned.count} award${earned.count === 1 ? "" : "s"} · earned, not paid` : undefined,
                  testId: "period-bonuses-earned",
                }
              : { label: "Bonuses earned", value: view.total, icon: Gift, accent, format: (v: number) => `${currency} ${Math.round(v).toLocaleString("en-US")}` },
            {
              label: periodMetrics?.summary ? "Active Closers" : "Qualified agents",
              value: periodMetrics?.summary ? periodMetrics.summary.activeClosers : view.qualified,
              icon: Users,
              accent: "#FF7AD9",
              sub: periodMetrics?.summary
                ? `${periodMetrics.summary.returned} ret · ${periodMetrics.summary.rejected} rej`
                : (kind === "monthly" ? `${daysLeft} days left this month` : undefined),
            },
          ]}
        />

        <TopPerformersPodium
          rows={rows}
          title={kind === "weekly" ? "TOP PERFORMERS THIS WEEK" : "TOP PERFORMERS THIS MONTH"}
          subtitle={`${dateRangeLabel} · ranked by validated sales, then submitted leads`}
          testId={`top3-${kind}`}
          bonusPeriod={kind === "weekly" ? "week" : "month"}
          tier={kind}
        />

        <div className="grid gap-5 md:grid-cols-2">
          <AwardFeed
            title={kind === "weekly" ? "WEEKLY ACHIEVEMENTS" : "MONTHLY ACHIEVEMENTS"}
            awards={view.periodAwards}
            currency={currency}
            accent={accent}
            empty={kind === "monthly" ? "No monthly achievements recorded yet." : "No weekly achievements recorded yet."}
          />
          <ArenaLiveActivity
            events={dataSourceMode === "production" ? realSalesEvents : activity}
            title="LATEST VALIDATED SALES"
            badge="LIVE"
            types={["sale-approved"]}
            limit={10}
            emptyText={`No validated sales recorded ${cfg.word} yet.`}
          />
        </div>
      </div>

      {showBoard && (
        <aside className="min-w-0 min-h-[560px] xl:sticky xl:top-20 xl:h-[calc(100vh-11rem)]">
          <LiveLeaderboard period={cfg.period} count={program?.leaderboardCount} />
        </aside>
      )}
    </div>
  );
}

function daysLeftInMonth(today: string): number {
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - d;
}
