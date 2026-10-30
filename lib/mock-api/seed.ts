import type {
  ActivityEvent,
  Agent,
  Campaign,
  Reward,
  Sale,
  SpinResult,
  Team,
  TargetRule,
} from "@/types";
import { dayKey, mulberry32, startOfDay } from "@/lib/utils";
import { HISTORY_DAYS, SCHEMA_VERSION, type ArenaData } from "./schema";

const FIRST = [
  "Ava", "Liam", "Noah", "Mia", "Zara", "Omar", "Leah", "Ethan", "Sofia", "Lucas",
  "Amara", "Daniel", "Hana", "Ryan", "Isla", "Ali", "Chloe", "Marcus", "Nadia", "Kai",
  "Priya", "Jonah", "Elena", "Tariq", "Grace", "Mateo", "Yuki", "Owen", "Layla", "Samir",
  "Ivy", "Felix", "Aisha", "Leo", "Maya", "Hamza", "Ruby", "Adrian", "Nora", "Bilal",
];
const LAST = [
  "Carter", "Khan", "Rivera", "Okafor", "Bennett", "Haddad", "Nguyen", "Fischer", "Malik", "Santos",
  "Brooks", "Iqbal", "Moreau", "Tanaka", "Hughes", "Rahman", "Silva", "Novak", "Ahmed", "Lindqvist",
  "Patel", "Costa", "Walsh", "Sheikh", "Kim", "Duarte", "Osei", "Romero", "Shah", "Petrov",
];

export const DEFAULT_CAMPAIGNS: Campaign[] = [
  { id: "cmp_fiber", name: "FiberMax Home", color: "#27D5FF", product: "Fiber Broadband" },
  { id: "cmp_energy", name: "BrightEnergy", color: "#FFC857", product: "Energy Plan" },
  { id: "cmp_mobile", name: "Nova Mobile", color: "#7568FF", product: "Mobile Contract" },
  { id: "cmp_shield", name: "ShieldCare", color: "#36E0B5", product: "Home Insurance" },
];

export const DEFAULT_TEAMS: Team[] = [
  { id: "team_titans", name: "Titans", color: "#7568FF", campaignId: "cmp_mobile", leadName: "Rachel Moore", active: true },
  { id: "team_falcons", name: "Falcons", color: "#27D5FF", campaignId: "cmp_fiber", leadName: "Imran Qureshi", active: true },
  { id: "team_phoenix", name: "Phoenix", color: "#FF7A59", campaignId: "cmp_energy", leadName: "Laura Chen", active: true },
  { id: "team_vipers", name: "Vipers", color: "#36E0B5", campaignId: "cmp_shield", leadName: "David Osei", active: true },
  { id: "team_storm", name: "Storm", color: "#5B8CFF", campaignId: "cmp_fiber", leadName: "Sara Lopez", active: true },
  { id: "team_royals", name: "Royals", color: "#FFC857", campaignId: "cmp_energy", leadName: "Kenji Watanabe", active: true },
];

export const DEFAULT_TARGET_RULES: TargetRule[] = [
  { id: "rule_default", teamId: null, salesPerSpin: 3, period: "daily", enabled: true, teamDailyTarget: 100, agentDailyTarget: 8 },
  { id: "rule_titans", teamId: "team_titans", salesPerSpin: 4, period: "daily", enabled: true, teamDailyTarget: 110, agentDailyTarget: 9 },
  { id: "rule_royals", teamId: "team_royals", salesPerSpin: 10, period: "weekly", enabled: true, teamDailyTarget: 95, agentDailyTarget: 8 },
];

export const DEFAULT_REWARDS: Reward[] = [
  { id: "rw_trophy", title: "Achievement Trophy", description: "Engraved crystal trophy for your desk.", icon: "trophy", color: "#E0A526", active: true, quantity: 50, weight: 1, order: 0 },
  { id: "rw_voucher", title: "Gift Voucher", description: "Digital gift voucher for partner stores.", icon: "ticket", color: "#1FB58F", active: true, quantity: 150, weight: 3, order: 1 },
  { id: "rw_merch", title: "Merchandise Pack", description: "Hoodie, bottle and Sales Arena swag.", icon: "package", color: "#6A5CF0", active: true, quantity: 120, weight: 3, order: 2 },
  { id: "rw_headset", title: "Premium Headset", description: "Noise-cancelling pro headset.", icon: "headphones", color: "#1B9FD1", active: true, quantity: 20, weight: 0.6, order: 3 },
  { id: "rw_badge", title: "Team Recognition", description: "Shout-out badge on the arena wall.", icon: "badge", color: "#D9466A", active: true, quantity: null, weight: 4, order: 4 },
  { id: "rw_surprise", title: "Surprise Gift", description: "A mystery gift picked by your lead.", icon: "gift", color: "#C2418F", active: true, quantity: 60, weight: 2, order: 5 },
  { id: "rw_coffee", title: "Coffee Run", description: "Your favourite coffee, delivered.", icon: "coffee", color: "#D2742F", active: true, quantity: null, weight: 4, order: 6 },
  { id: "rw_early", title: "Early Finish Pass", description: "Leave 30 minutes early on a day of choice.", icon: "rocket", color: "#3E57D6", active: true, quantity: 40, weight: 1.5, order: 7 },
];

const TITLES = ["Sales Agent", "Senior Agent", "Sales Specialist", "Closer", "Team Captain"];

export interface SeedOptions {
  now?: Date;
  seed?: number;
  /** Preserve configuration (teams/agents/rules/rewards) when rolling over to a new day. */
  keep?: Pick<ArenaData, "campaigns" | "teams" | "agents" | "targetRules" | "rewards"> | null;
}

/**
 * Generates a realistic, deterministic mock data set for the given day.
 * Same seed + same day → same data, which keeps tests stable.
 */
export function createSeedData(options: SeedOptions = {}): ArenaData {
  const now = options.now ?? new Date();
  const key = dayKey(now);
  const rng = mulberry32((options.seed ?? 20261027) ^ hashDay(key));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const between = (a: number, b: number) => a + rng() * (b - a);

  const campaigns = options.keep?.campaigns ?? DEFAULT_CAMPAIGNS;
  const teams = options.keep?.teams ?? DEFAULT_TEAMS;
  const targetRules = options.keep?.targetRules ?? DEFAULT_TARGET_RULES;
  const rewards = options.keep?.rewards ?? DEFAULT_REWARDS;

  let agents: Agent[];
  if (options.keep?.agents) {
    agents = options.keep.agents;
  } else {
    agents = [];
    const used = new Set<string>();
    const perTeam = 14;
    teams.forEach((team, ti) => {
      for (let i = 0; i < perTeam; i++) {
        let name = "";
        do {
          name = `${pick(FIRST)} ${pick(LAST)}`;
        } while (used.has(name));
        used.add(name);
        const [f, l] = name.split(" ");
        agents.push({
          id: `agt_${ti}_${i}`,
          name,
          initials: `${f[0]}${l[0]}`,
          teamId: team.id,
          campaignId: team.campaignId,
          active: rng() > 0.06,
          title: i === 0 ? "Team Captain" : pick(TITLES.slice(0, 4)),
          hue: Math.floor(rng() * 360),
          joinedAt: new Date(now.getTime() - Math.floor(between(60, 1400)) * 86400000).toISOString(),
        });
      }
    });
  }

  // Skill level drives consistent performance across history and today.
  const skill = new Map<string, number>();
  agents.forEach((a) => skill.set(a.id, between(0.35, 1.45)));

  const dayStart = startOfDay(now).getTime();
  const shiftStart = Math.max(dayStart + 60_000, now.getTime() - 6 * 3600_000);
  const span = Math.max(60_000, now.getTime() - shiftStart);
  const elapsedHours = span / 3600_000;

  const sales: Sale[] = [];
  const history: Record<string, number[]> = {};
  const historySubmitted: Record<string, number[]> = {};
  let saleIdx = 0;

  for (const agent of agents) {
    const s = skill.get(agent.id) ?? 1;
    history[agent.id] = Array.from({ length: HISTORY_DAYS }, () =>
      agent.active ? Math.max(0, Math.round(s * 9 * between(0.55, 1.25))) : 0,
    );
    // Past days: submitted leads = validated + some that were not validated.
    historySubmitted[agent.id] = history[agent.id].map((v) => v + Math.round(v * between(0.25, 0.85)) + (rng() < 0.3 ? 1 : 0));
    if (!agent.active) continue;
    const today = Math.max(0, Math.round(s * elapsedHours * between(0.6, 1.2)));
    // Submitted leads that are not (yet) validated.
    const pending = rng() < 0.55 ? 1 + Math.floor(rng() * 2) : 0;
    const rejected = Math.round(today * between(0.15, 0.6));
    const duplicate = rng() < 0.2 ? 1 : 0;
    const outcomes: Sale["status"][] = [
      ...Array<Sale["status"]>(today).fill("approved"),
      ...Array<Sale["status"]>(pending).fill("pending"),
      ...Array<Sale["status"]>(rejected).fill("rejected"),
      ...Array<Sale["status"]>(duplicate).fill("duplicate"),
    ];
    const campaign = campaigns.find((c) => c.id === agent.campaignId);
    for (const status of outcomes) {
      const created = shiftStart + rng() * span * 0.98;
      const isPending = status !== "approved";
      sales.push({
        id: `sale_seed_${saleIdx++}`,
        agentId: agent.id,
        teamId: agent.teamId,
        campaignId: agent.campaignId,
        status,
        product: campaign?.product ?? "Sale",
        value: Math.round(between(29, 189)),
        createdAt: new Date(created).toISOString(),
        approvedAt: isPending ? null : new Date(Math.min(now.getTime(), created + between(2, 25) * 60_000)).toISOString(),
        source: "seed",
      });
    }
  }
  sales.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Seed spin history: some of today's earned credits have already been used.
  const spins: SpinResult[] = [];
  const issued = new Map<string, number>();
  const activeRewards = rewards.filter((r) => r.active);
  const chooseReward = (): Reward | null => {
    const eligible = activeRewards.filter((r) => r.quantity === null || (issued.get(r.id) ?? 0) < r.quantity);
    const total = eligible.reduce((t, r) => t + r.weight, 0);
    let roll = rng() * total;
    for (const r of eligible) {
      roll -= r.weight;
      if (roll <= 0) return r;
    }
    return eligible[eligible.length - 1] ?? null;
  };
  const ruleFor = (teamId: string) => targetRules.find((r) => r.teamId === teamId) ?? targetRules.find((r) => r.teamId === null)!;
  const todayCounts = new Map<string, number>();
  sales.forEach((s) => s.status === "approved" && todayCounts.set(s.agentId, (todayCounts.get(s.agentId) ?? 0) + 1));

  let spinIdx = 0;
  for (const agent of agents) {
    const rule = ruleFor(agent.teamId);
    if (!rule?.enabled) continue;
    const periodSales =
      (todayCounts.get(agent.id) ?? 0) +
      (rule.period === "weekly" ? history[agent.id].slice(0, 6).reduce((t, n) => t + n, 0) : 0);
    const earned = Math.floor(periodSales / rule.salesPerSpin);
    const used = Math.floor(earned * between(0.3, 0.85));
    for (let i = 0; i < used; i++) {
      const reward = chooseReward();
      if (!reward) break;
      issued.set(reward.id, (issued.get(reward.id) ?? 0) + 1);
      const t = rule.period === "weekly" && rng() < 0.6
        ? dayStart - Math.floor(between(0, 6)) * 86400000 - between(3600_000, 8 * 3600_000)
        : shiftStart + rng() * span * 0.95;
      const created = new Date(Math.min(t, now.getTime() - 60_000)).toISOString();
      spins.push({
        id: `spin_seed_${spinIdx++}`,
        agentId: agent.id,
        rewardId: reward.id,
        rewardTitle: reward.title,
        rewardColor: reward.color,
        rewardIcon: reward.icon,
        createdAt: created,
        completedAt: created,
        status: rng() < 0.45 ? "fulfilled" : "completed",
        mode: "simulated",
        seed: null,
      });
    }
  }
  spins.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const approvedToday = sales.filter((s) => s.status === "approved");
  const activity: ActivityEvent[] = [
    ...approvedToday.slice(-28).map<ActivityEvent>((s) => ({
      id: `act_${s.id}`,
      type: "sale-approved",
      message: `${agentName.get(s.agentId)} closed a ${s.product} sale`,
      agentId: s.agentId,
      teamId: s.teamId,
      createdAt: s.approvedAt ?? s.createdAt,
      simulated: true,
    })),
    ...spins
      .filter((s) => new Date(s.createdAt).getTime() >= dayStart)
      .slice(0, 10)
      .map<ActivityEvent>((s) => ({
        id: `act_${s.id}`,
        type: "spin-completed",
        message: `${agentName.get(s.agentId)} won ${s.rewardTitle}`,
        agentId: s.agentId,
        teamId: null,
        createdAt: s.createdAt,
        simulated: true,
      })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Pre-mark milestones / team targets that are already passed so they are not re-celebrated.
  const teamTarget = (teamId: string) => ruleFor(teamId)?.teamDailyTarget ?? 0;
  const totalTarget = teams.filter((t) => t.active).reduce((t, team) => t + teamTarget(team.id), 0);
  const ratio = totalTarget > 0 ? approvedToday.length / totalTarget : 0;
  const celebratedMilestones = [25, 50, 75, 100].filter((m) => ratio * 100 >= m);
  const teamTargetsHit = teams
    .filter((t) => approvedToday.filter((s) => s.teamId === t.id).length >= teamTarget(t.id))
    .map((t) => t.id);

  const firstActive = agents.find((a) => a.active) ?? agents[0];

  return {
    schemaVersion: SCHEMA_VERSION,
    dayKey: key,
    campaigns,
    teams,
    agents,
    sales,
    history,
    historySubmitted,
    targetRules,
    rewards,
    spins,
    bonusCredits: firstActive ? { [firstActive.id]: 2 } : {},
    activity,
    currentAgentId: firstActive?.id ?? "",
    celebratedMilestones,
    teamTargetsHit,
    lastSyncAt: null,
    dataSourceMode: "demo",
    apiSyncStatus: "unconfigured",
    apiSyncError: null,
    safeQuoteSummary: null,
    serverSpinBalance: null,
  };
}

function hashDay(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** The Final Expense campaign the live floor runs (no team structure). */
export const FE_CAMPAIGN: Campaign = { id: "cmp_fe", name: "Final Expense", color: "#FFC857", product: "Final Expense" };

/**
 * Initial state for live (Safe Quote) mode: no demo agents, teams, sales, spins or
 * activity. Real data replaces it only after a verified API response.
 */
export function createLiveData(now: Date = new Date()): ArenaData {
  return {
    schemaVersion: SCHEMA_VERSION,
    dayKey: dayKey(now),
    campaigns: [FE_CAMPAIGN],
    teams: [],
    agents: [],
    sales: [],
    history: {},
    historySubmitted: {},
    targetRules: [{ id: "rule_default", teamId: null, salesPerSpin: 2, period: "daily", enabled: true, teamDailyTarget: 0, agentDailyTarget: 0 }],
    rewards: [], // live wheel = PostgreSQL catalog (loaded by LiveApiSync), never seed prizes
    spins: [],
    bonusCredits: {},
    activity: [],
    currentAgentId: "",
    celebratedMilestones: [],
    teamTargetsHit: [],
    lastSyncAt: null,
    dataSourceMode: "production",
    apiSyncStatus: "connecting",
    apiSyncError: null,
    safeQuoteSummary: null,
    periodMetrics: undefined,
    serverSpinBalance: null,
  };
}
