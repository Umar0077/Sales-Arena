import type { ArenaStatistics, LeaderboardEntry, LeaderboardPeriod, TeamStanding } from "@/types";
import type { ArenaData } from "@/lib/mock-api/schema";
import { computeAllCredits, ruleForTeam, teamTarget } from "@/features/targets/eligibility";
import { startOfDay } from "@/lib/utils";

const ACHIEVEMENT_TYPES = new Set(["spin-unlocked", "milestone", "top-performer", "team-target", "special"]);

export function computeArenaStatistics(data: ArenaData, now?: Date, teamId?: string | null): ArenaStatistics {
  const latestSaleTime = data.sales.length > 0 ? new Date(data.sales[data.sales.length - 1].createdAt) : new Date();
  const refTime = now ?? latestSaleTime;
  const teamFilter = (id: string) => !teamId || id === teamId;
  const activeTeams = data.teams.filter((t) => t.active && teamFilter(t.id));
  const activeTeamIds = new Set(activeTeams.map((t) => t.id));
  let approvedToday = 0;
  let pendingToday = 0;
  for (const s of data.sales) {
    if (!teamFilter(s.teamId)) continue;
    if (s.status === "approved") approvedToday++;
    else if (s.status === "pending") pendingToday++;
  }
  const targetToday = activeTeams.reduce((t, team) => t + teamTarget(data, team.id), 0);
  const credits = computeAllCredits(data, refTime);
  let spinsUnlocked = 0;
  let spinsAvailable = 0;
  const agents = data.agents.filter((a) => teamFilter(a.teamId));
  for (const a of agents) {
    const c = credits.get(a.id);
    if (!c) continue;
    spinsUnlocked += c.earned + c.bonus;
    spinsAvailable += c.available;
  }
  const dayStart = startOfDay(refTime).getTime();
  const agentIds = new Set(agents.map((a) => a.id));
  const spinsToday = data.spins.filter(
    (s) => s.status !== "cancelled" && agentIds.has(s.agentId) && new Date(s.createdAt).getTime() >= dayStart,
  );
  const achievementsToday = data.activity.filter(
    (e) => ACHIEVEMENT_TYPES.has(e.type) && new Date(e.createdAt).getTime() >= dayStart && (!teamId || e.teamId === teamId || e.teamId === null),
  ).length;
  const activeRules = data.targetRules.filter((r) => r.enabled).length;

  return {
    approvedToday,
    pendingToday,
    targetToday,
    remaining: Math.max(0, targetToday - approvedToday),
    completion: targetToday > 0 ? approvedToday / targetToday : 0,
    achievementsToday,
    activeAgents: agents.filter((a) => a.active && activeTeamIds.has(a.teamId)).length,
    totalAgents: agents.length,
    spinsUnlocked,
    spinsUsed: spinsToday.length,
    spinsAvailable,
    rewardsIssued: data.spins.filter((s) => s.status === "completed" || s.status === "fulfilled").length,
    teams: activeTeams.length,
    activeTargets: activeRules,
  };
}

export interface LeaderboardFilter {
  period: LeaderboardPeriod;
  campaignId?: string | null;
  teamId?: string | null;
  includeInactive?: boolean;
}

function periodDays(period: LeaderboardPeriod): number {
  return period === "daily" ? 0 : period === "weekly" ? 6 : 29;
}

/** Approved sales per agent for the period. `cutoff` excludes today's sales approved after that time. */
export function salesForPeriod(data: ArenaData, period: LeaderboardPeriod, cutoff?: number): Map<string, number> {
  const map = new Map<string, number>();
  const days = periodDays(period);
  for (const a of data.agents) {
    const hist = data.history[a.id] ?? [];
    let n = 0;
    for (let i = 0; i < days; i++) n += hist[i] ?? 0;
    map.set(a.id, n);
  }
  for (const s of data.sales) {
    if (s.status !== "approved") continue;
    if (cutoff !== undefined && new Date(s.approvedAt ?? s.createdAt).getTime() > cutoff) continue;
    map.set(s.agentId, (map.get(s.agentId) ?? 0) + 1);
  }
  return map;
}

function rankOrder(counts: Map<string, number>, ids: string[], names: Map<string, string>): string[] {
  return [...ids].sort((a, b) => {
    const d = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    return d !== 0 ? d : (names.get(a) ?? "").localeCompare(names.get(b) ?? "");
  });
}

export function computeLeaderboard(data: ArenaData, filter: LeaderboardFilter, now?: Date): LeaderboardEntry[] {
  const latestSaleTime = data.sales.length > 0 ? new Date(data.sales[data.sales.length - 1].createdAt) : new Date();
  const refTime = now ?? latestSaleTime;
  const agents = data.agents.filter(
    (a) =>
      (filter.includeInactive || a.active) &&
      (!filter.campaignId || a.campaignId === filter.campaignId) &&
      (!filter.teamId || a.teamId === filter.teamId),
  );
  const ids = agents.map((a) => a.id);
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const current = salesForPeriod(data, filter.period);
  const before = salesForPeriod(data, filter.period, refTime.getTime() - 3600_000);
  const order = rankOrder(current, ids, names);
  const prevOrder = rankOrder(before, ids, names);
  const prevRank = new Map(prevOrder.map((id, i) => [id, i + 1]));
  const teams = new Map(data.teams.map((t) => [t.id, t]));
  const byId = new Map(agents.map((a) => [a.id, a]));
  const multiplier = filter.period === "daily" ? 1 : filter.period === "weekly" ? 7 : 30;

  return order.map((id, i) => {
    const agent = byId.get(id)!;
    const target = ruleForTeam(data.targetRules, agent.teamId).agentDailyTarget * multiplier;
    const sales = current.get(id) ?? 0;
    return {
      agent,
      team: teams.get(agent.teamId),
      sales,
      rank: i + 1,
      movement: (prevRank.get(id) ?? i + 1) - (i + 1),
      progress: target > 0 ? sales / target : 0,
    };
  });
}

export function computeTeamStandings(data: ArenaData, period: LeaderboardPeriod = "daily", campaignId?: string | null): TeamStanding[] {
  const counts = salesForPeriod(data, period);
  const multiplier = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
  const standings = data.teams
    .filter((t) => t.active && (!campaignId || t.campaignId === campaignId))
    .map((team) => {
      const members = data.agents.filter((a) => a.teamId === team.id);
      const sales = members.reduce((t, a) => t + (counts.get(a.id) ?? 0), 0);
      const target = teamTarget(data, team.id) * multiplier;
      return { team, sales, target, progress: target > 0 ? sales / target : 0, agents: members.filter((a) => a.active).length, rank: 0 };
    })
    .sort((a, b) => b.sales - a.sales || a.team.name.localeCompare(b.team.name));
  standings.forEach((s, i) => (s.rank = i + 1));
  return standings;
}

/** Approved sales per hour bucket for today (for charts). */
export function hourlySales(data: ArenaData, now: Date = new Date()): Array<{ hour: string; sales: number; pending: number }> {
  const start = startOfDay(now);
  const buckets = new Map<number, { sales: number; pending: number }>();
  for (const s of data.sales) {
    const h = new Date(s.approvedAt ?? s.createdAt).getHours();
    const b = buckets.get(h) ?? { sales: 0, pending: 0 };
    if (s.status === "approved") b.sales++;
    else if (s.status === "pending") b.pending++;
    buckets.set(h, b);
  }
  const hours = [...buckets.keys()];
  const first = hours.length ? Math.min(...hours) : now.getHours();
  const last = now.getHours();
  const out: Array<{ hour: string; sales: number; pending: number }> = [];
  for (let h = Math.min(first, last); h <= last; h++) {
    const d = new Date(start);
    d.setHours(h);
    const b = buckets.get(h) ?? { sales: 0, pending: 0 };
    out.push({ hour: `${String(h).padStart(2, "0")}:00`, ...b });
  }
  return out;
}

/** Last N days of approved sales totals (from history + today). */
export function dailyTotals(data: ArenaData, days = 14, now: Date = new Date()): Array<{ day: string; sales: number }> {
  const out: Array<{ day: string; sales: number }> = [];
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  for (let i = days - 1; i >= 1; i--) {
    const total = data.agents.reduce((t, a) => t + (data.history[a.id]?.[i - 1] ?? 0), 0);
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push({ day: fmt.format(d), sales: total });
  }
  out.push({ day: "Today", sales: data.sales.filter((s) => s.status === "approved").length });
  return out;
}
