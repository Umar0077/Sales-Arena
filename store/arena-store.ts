"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  ActivityEvent,
  ActivityType,
  Agent,
  CelebrationEvent,
  CelebrationTier,
  Reward,
  Sale,
  SaleSource,
  SaleStatus,
  SpinResult,
  SpinSelectionMode,
  SpinStatus,
  Team,
  TargetRule,
} from "@/types";
import { ACTIVITY_LIMIT, SCHEMA_VERSION, type ArenaData, type PeriodMetrics } from "@/lib/mock-api/schema";
import type { CloserRow } from "@/features/sales/leads";
import { createSeedData, createLiveData } from "@/lib/mock-api/seed";
import { arenaBus } from "@/lib/events/bus";
import { buildCreditContext, computeSpinCredit, ruleForTeam, teamTarget } from "@/features/targets/eligibility";
import { issuedCounts, seededRandom, selectReward, wheelRewards } from "@/features/spins/selector";
import { validateWheel } from "@/features/rewards/validation";
import { TIERS } from "@/features/celebrations/tiers";
import { dayKey, uid } from "@/lib/utils";

export const DATA_STORAGE_KEY = "sales-arena:data";

export interface RecordSaleInput {
  agentId: string;
  /** "approved" = validated sale. Other statuses are submitted leads that never earn spins. */
  status?: SaleStatus;
  source?: SaleSource;
  /** Set false to update data silently (e.g. bulk seeding). */
  celebrate?: boolean;
  value?: number;
}

export interface RecordSaleResult {
  sale: Sale;
  celebration: CelebrationEvent | null;
  achievements: CelebrationTier[];
}

export type StartSpinResult =
  | { ok: true; spin: SpinResult; reward: Reward; segmentIndex: number; segments: Reward[] }
  | { ok: false; reason: string };

export interface ArenaActions {
  hydrated: boolean;
  /** Live Safe Quote mode: never seeded with demo records, never restored from old demo storage. Not persisted. */
  liveMode: boolean;
  /** Switch to live mode with an empty, real-data-only state. */
  enterLiveMode: () => void;
  ensureFreshDay: () => void;
  recordSale: (input: RecordSaleInput) => RecordSaleResult | null;
  approvePendingSale: (saleId: string) => RecordSaleResult | null;
  /** Change a lead's status. Validating runs the full celebration/spin pipeline; anything else un-validates it. */
  setLeadStatus: (saleId: string, status: SaleStatus) => RecordSaleResult | null;
  addBonusCredits: (agentId: string, amount: number) => void;
  startSpin: (agentId: string, options?: { seeded?: boolean; seed?: number; serverRewardId?: string }) => StartSpinResult;
  completeSpin: (spinId: string) => SpinResult | null;
  setSpinStatus: (spinId: string, status: SpinStatus) => void;
  setCurrentAgent: (agentId: string) => void;
  upsertAgent: (agent: Omit<Agent, "id" | "initials" | "joinedAt" | "hue"> & { id?: string }) => Agent;
  setAgentActive: (agentId: string, active: boolean) => void;
  upsertTeam: (team: Omit<Team, "id"> & { id?: string }) => Team;
  assignAgentsToTeam: (teamId: string, agentIds: string[]) => void;
  upsertTargetRule: (rule: Omit<TargetRule, "id"> & { id?: string }) => TargetRule;
  deleteTargetRule: (ruleId: string) => void;
  upsertReward: (reward: Omit<Reward, "id" | "order"> & { id?: string }) => { ok: boolean; message?: string; reward?: Reward };
  deleteReward: (rewardId: string) => { ok: boolean; message?: string };
  reorderRewards: (ids: string[]) => void;
  logActivity: (type: ActivityType, message: string, extra?: Partial<ActivityEvent>) => void;
  markSynced: () => void;
  resetDemo: () => void;
  syncRealData: (payload: {
    agents?: Agent[];
    sales?: Sale[];
    summary?: ArenaData["safeQuoteSummary"];
    mode?: "demo" | "production";
  }) => void;
  setApiStatus: (status: "connected" | "connecting" | "error" | "unconfigured", error?: string | null) => void;
  setDataSourceMode: (mode: "demo" | "production") => void;
  setPeriodMetrics: (period: "day" | "week" | "month", metrics: Partial<PeriodMetrics>) => void;
  setAllTimeMetrics: (data: { summary: ArenaData["safeQuoteSummary"]; closers?: CloserRow[] }) => void;
  setServerSpinBalance: (balance: { unlocked: number; available: number } | null) => void;
}

export type ArenaStore = ArenaData & ArenaActions;

const DATA_KEYS: Array<keyof ArenaData> = [
  "schemaVersion", "dayKey", "campaigns", "teams", "agents", "sales", "history", "historySubmitted", "targetRules",
  "rewards", "spins", "bonusCredits", "activity", "currentAgentId", "celebratedMilestones",
  "teamTargetsHit", "lastSyncAt", "dataSourceMode", "apiSyncStatus", "apiSyncError", "safeQuoteSummary", "periodMetrics",
  "serverSpinBalance",
];

export function pickData(s: ArenaStore | ArenaData): ArenaData {
  const out = {} as Record<string, unknown>;
  for (const k of DATA_KEYS) out[k] = (s as unknown as Record<string, unknown>)[k];
  return out as unknown as ArenaData;
}

function makeActivity(type: ActivityType, message: string, extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: uid("act"),
    type,
    message,
    agentId: null,
    teamId: null,
    createdAt: new Date().toISOString(),
    simulated: true,
    ...extra,
  };
}

function prependActivity(list: ActivityEvent[], items: ActivityEvent[]): ActivityEvent[] {
  return [...items, ...list].slice(0, ACTIVITY_LIMIT);
}

function dailyCounts(sales: Sale[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sales) if (s.status === "approved") m.set(s.agentId, (m.get(s.agentId) ?? 0) + 1);
  return m;
}

function topAgent(counts: Map<string, number>, agents: Agent[]): string | null {
  let best: string | null = null;
  let bestN = -1;
  for (const a of agents) {
    if (!a.active) continue;
    const n = counts.get(a.id) ?? 0;
    if (n > bestN || (n === bestN && best !== null && a.name.localeCompare(agents.find((x) => x.id === best)!.name) < 0)) {
      best = a.id;
      bestN = n;
    }
  }
  return best;
}

const SPECIAL_COUNTS: Record<number, string> = { 10: "Perfect 10", 15: "Unstoppable 15", 20: "Legendary 20", 25: "Hall of Fame 25" };

const initialData = (): ArenaData => createSeedData();

export const useArenaStore = create<ArenaStore>()(
  persist(
    (set, get) => {
      /** Core pipeline that applies an approved sale and derives celebrations. */
      const applyApproved = (state: ArenaStore, sale: Sale, celebrate: boolean): RecordSaleResult => {
        const agent = state.agents.find((a) => a.id === sale.agentId)!;
        const team = state.teams.find((t) => t.id === agent.teamId);
        const campaign = state.campaigns.find((c) => c.id === agent.campaignId);
        const beforeCredit = computeSpinCredit(state, agent.id, buildCreditContext(state));
        const beforeCounts = dailyCounts(state.sales);
        const beforeTop = topAgent(beforeCounts, state.agents);

        const sales = state.sales.some((s) => s.id === sale.id)
          ? state.sales.map((s) => (s.id === sale.id ? sale : s))
          : [...state.sales, sale];
        const next: ArenaData = { ...pickData(state), sales };
        const afterCredit = computeSpinCredit(next, agent.id, buildCreditContext(next));
        const afterCounts = dailyCounts(sales);
        const afterTop = topAgent(afterCounts, state.agents);
        const agentCount = afterCounts.get(agent.id) ?? 0;

        const achievements: CelebrationTier[] = ["sale"];
        const activity: ActivityEvent[] = [
          makeActivity("sale-approved", `${agent.name} closed a ${sale.product} sale`, {
            agentId: agent.id,
            teamId: agent.teamId,
          }),
        ];
        let headline = "Approved Sale";
        let subline = `${sale.product}${campaign ? ` · ${campaign.name}` : ""} — sale #${agentCount} today`;
        let primary: CelebrationTier = "sale";
        const promote = (tier: CelebrationTier, h: string, sub: string) => {
          achievements.push(tier);
          if (TIERS[tier].priority > TIERS[primary].priority) {
            primary = tier;
            headline = h;
            subline = sub;
          }
        };

        if (afterCredit.earned > beforeCredit.earned) {
          promote("spin-unlocked", "Spin Unlocked!", `${afterCredit.available} spin${afterCredit.available === 1 ? "" : "s"} ready in the Spin Arena`);
          activity.push(makeActivity("spin-unlocked", `${agent.name} unlocked a reward spin`, { agentId: agent.id, teamId: agent.teamId }));
        }

        const activeTeams = state.teams.filter((t) => t.active);
        const totalTarget = activeTeams.reduce((t, tm) => t + teamTarget(state, tm.id), 0);
        const totalApproved = sales.filter((s) => s.status === "approved").length;
        const ratio = totalTarget > 0 ? (totalApproved / totalTarget) * 100 : 0;
        const newMilestones = [25, 50, 75, 100].filter((m) => ratio >= m && !state.celebratedMilestones.includes(m));
        if (newMilestones.length) {
          const m = Math.max(...newMilestones);
          promote(
            "milestone",
            m === 100 ? "Floor Target Smashed!" : `${m}% of Today's Target`,
            `${totalApproved} of ${totalTarget} approved sales — sealed by ${agent.name}`,
          );
          activity.push(makeActivity("milestone", `Floor reached ${m}% of today's target`, { agentId: agent.id }));
        }

        if (afterTop === agent.id && beforeTop !== agent.id && agentCount >= 3) {
          promote("top-performer", "New #1 on the Board", `${agent.name} takes the lead with ${agentCount} sales`);
          activity.push(makeActivity("top-performer", `${agent.name} moved to #1`, { agentId: agent.id, teamId: agent.teamId }));
        }

        const teamSales = sales.filter((s) => s.status === "approved" && s.teamId === agent.teamId).length;
        const tTarget = teamTarget(state, agent.teamId);
        const teamHit = team && teamSales >= tTarget && !state.teamTargetsHit.includes(team.id);
        if (teamHit && team) {
          promote("team-target", `Team ${team.name} Hit Target!`, `${teamSales}/${tTarget} approved sales — final sale by ${agent.name}`);
          activity.push(makeActivity("team-target", `Team ${team.name} completed today's target`, { agentId: agent.id, teamId: team.id }));
        }

        if (SPECIAL_COUNTS[agentCount]) {
          promote("special", SPECIAL_COUNTS[agentCount], `${agent.name} reached ${agentCount} approved sales today`);
          activity.push(makeActivity("special", `${agent.name} earned "${SPECIAL_COUNTS[agentCount]}"`, { agentId: agent.id, teamId: agent.teamId }));
        }

        const celebration: CelebrationEvent | null = celebrate
          ? {
              id: uid("cel"),
              tier: primary,
              headline,
              subline,
              agentId: agent.id,
              agentName: agent.name,
              teamName: team?.name ?? null,
              teamColor: team?.color ?? null,
              value: agentCount,
              createdAt: new Date().toISOString(),
              preview: false,
            }
          : null;

        set({
          sales,
          activity: prependActivity(state.activity, activity.reverse()),
          celebratedMilestones: [...state.celebratedMilestones, ...newMilestones],
          teamTargetsHit: teamHit && team ? [...state.teamTargetsHit, team.id] : state.teamTargetsHit,
        });

        arenaBus.emit("sale:recorded", { sale });
        if (afterCredit.earned > beforeCredit.earned)
          arenaBus.emit("spin:unlocked", { agentId: agent.id, available: afterCredit.available, reason: "target", periodSales: afterCredit.periodSales });
        if (celebration) arenaBus.emit("celebration:enqueue", { event: celebration });
        return { sale, celebration, achievements };
      };

      return {
        ...initialData(),
        hydrated: false,
        liveMode: false,
        enterLiveMode: () => set({ ...createLiveData(), liveMode: true, hydrated: true }),

        ensureFreshDay: () => {
          const s = get();
          if (s.liveMode) return; // live data is never reseeded with demo records
          const today = dayKey();
          if (s.agents.length === 0 || s.schemaVersion !== SCHEMA_VERSION) {
            set({ ...createSeedData() });
            return;
          }
          if (s.dayKey !== today) {
            // New day: regenerate activity while keeping admin configuration.
            set({
              ...createSeedData({
                keep: { campaigns: s.campaigns, teams: s.teams, agents: s.agents, targetRules: s.targetRules, rewards: s.rewards },
              }),
              currentAgentId: s.currentAgentId,
            });
            return;
          }
          // A spin interrupted by a refresh already had its result chosen — finalise it.
          if (s.spins.some((sp) => sp.status === "in-progress")) {
            set({
              spins: s.spins.map((sp) =>
                sp.status === "in-progress" ? { ...sp, status: "completed", completedAt: new Date().toISOString() } : sp,
              ),
            });
          }
        },

        recordSale: (input) => {
          const state = get();
          const agent = state.agents.find((a) => a.id === input.agentId);
          if (!agent) return null;
          const campaign = state.campaigns.find((c) => c.id === agent.campaignId);
          const now = new Date().toISOString();
          const status = input.status ?? "approved";
          const sale: Sale = {
            id: uid("sale"),
            agentId: agent.id,
            teamId: agent.teamId,
            campaignId: agent.campaignId,
            status,
            product: campaign?.product ?? "Sale",
            value: input.value ?? Math.round(29 + Math.random() * 160),
            createdAt: now,
            approvedAt: status === "approved" ? now : null,
            source: input.source ?? "demo-simulator",
          };
          if (status !== "approved") {
            const msg =
              status === "pending"
                ? `${agent.name} submitted a lead for validation`
                : status === "rejected"
                  ? `${agent.name}'s lead was rejected`
                  : `${agent.name}'s lead was flagged as a duplicate`;
            set({
              sales: [...state.sales, sale],
              activity: prependActivity(state.activity, [makeActivity("sale-pending", msg, { agentId: agent.id, teamId: agent.teamId })]),
            });
            arenaBus.emit("sale:recorded", { sale });
            return { sale, celebration: null, achievements: [] };
          }
          return applyApproved(state, sale, input.celebrate !== false);
        },

        approvePendingSale: (saleId) => {
          const state = get();
          const sale = state.sales.find((s) => s.id === saleId && s.status === "pending");
          if (!sale) return null;
          return applyApproved(state, { ...sale, status: "approved", approvedAt: new Date().toISOString() }, true);
        },

        setLeadStatus: (saleId, status) => {
          const state = get();
          const sale = state.sales.find((s) => s.id === saleId);
          if (!sale || sale.status === status) return null;
          if (status === "approved") {
            return applyApproved(state, { ...sale, status: "approved", approvedAt: new Date().toISOString() }, true);
          }
          const agent = state.agents.find((a) => a.id === sale.agentId);
          const updated: Sale = { ...sale, status, approvedAt: null };
          set({
            sales: state.sales.map((s) => (s.id === saleId ? updated : s)),
            activity: prependActivity(state.activity, [
              makeActivity("admin-change", `${agent?.name ?? "Agent"}'s lead marked ${status}`, { agentId: sale.agentId, teamId: sale.teamId }),
            ]),
          });
          arenaBus.emit("sale:recorded", { sale: updated });
          return { sale: updated, celebration: null, achievements: [] };
        },

        addBonusCredits: (agentId, amount) => {
          const s = get();
          const agent = s.agents.find((a) => a.id === agentId);
          if (!agent || amount <= 0) return;
          set({
            bonusCredits: { ...s.bonusCredits, [agentId]: (s.bonusCredits[agentId] ?? 0) + amount },
            activity: prependActivity(s.activity, [
              makeActivity("spin-unlocked", `${agent.name} received ${amount} demo spin credit${amount > 1 ? "s" : ""}`, {
                agentId,
                teamId: agent.teamId,
              }),
            ]),
          });
          const credit = computeSpinCredit(pickData(get()), agentId);
          arenaBus.emit("spin:unlocked", { agentId, available: credit.available, reason: "bonus", periodSales: credit.periodSales });
        },

        startSpin: (agentId, options = {}) => {
          const s = get();
          const agent = s.agents.find((a) => a.id === agentId);
          if (!agent) return { ok: false, reason: "Agent not found." };
          if (s.spins.some((sp) => sp.status === "in-progress"))
            return { ok: false, reason: "A spin is already in progress." };
          const credit = computeSpinCredit(s, agentId);
          if (credit.available <= 0) return { ok: false, reason: "No spin credits available." };
          const wheelCheck = validateWheel(s.rewards);
          if (!wheelCheck.valid) return { ok: false, reason: wheelCheck.message ?? "Wheel configuration invalid." };

          const segments = wheelRewards(s.rewards);
          const issued = issuedCounts(s.spins);
          let reward: Reward | null = null;
          let mode: SpinSelectionMode = "simulated";
          let seed: number | null = null;
          if (options.serverRewardId) {
            reward = segments.find((r) => r.id === options.serverRewardId) ?? null;
            mode = "server";
          } else {
            const spinNumber = s.spins.filter((sp) => sp.agentId === agentId).length;
            if (options.seeded) {
              seed = options.seed ?? 1;
              mode = "seeded-test";
            }
            const random = options.seeded ? seededRandom(seed!, agentId, spinNumber) : Math.random;
            reward = selectReward(s.rewards, issued, random);
          }
          if (!reward) return { ok: false, reason: "No rewards are currently in stock." };
          const now = new Date().toISOString();
          const spin: SpinResult = {
            id: uid("spin"),
            agentId,
            rewardId: reward.id,
            rewardTitle: reward.title,
            rewardColor: reward.color,
            rewardIcon: reward.icon,
            createdAt: now,
            completedAt: null,
            status: "in-progress",
            mode,
            seed,
          };
          set({ spins: [spin, ...s.spins] });
          arenaBus.emit("spin:started", { spin });
          return { ok: true, spin, reward, segmentIndex: segments.indexOf(reward), segments };
        },

        completeSpin: (spinId) => {
          const s = get();
          const spin = s.spins.find((sp) => sp.id === spinId);
          if (!spin || spin.status !== "in-progress") return null; // exactly-once guarantee
          const agent = s.agents.find((a) => a.id === spin.agentId);
          const done: SpinResult = { ...spin, status: "completed", completedAt: new Date().toISOString() };
          set({
            spins: s.spins.map((sp) => (sp.id === spinId ? done : sp)),
            activity: prependActivity(s.activity, [
              makeActivity("spin-completed", `${agent?.name ?? "Agent"} won ${spin.rewardTitle}`, {
                agentId: spin.agentId,
                teamId: agent?.teamId ?? null,
              }),
            ]),
          });
          arenaBus.emit("spin:completed", { spin: done });
          return done;
        },

        setSpinStatus: (spinId, status) => {
          set({ spins: get().spins.map((sp) => (sp.id === spinId ? { ...sp, status } : sp)) });
        },

        setCurrentAgent: (agentId) => {
          if (get().agents.some((a) => a.id === agentId)) set({ currentAgentId: agentId });
        },

        upsertAgent: (input) => {
          const s = get();
          const team = s.teams.find((t) => t.id === input.teamId);
          const parts = input.name.trim().split(/\s+/);
          const initials = `${parts[0]?.[0] ?? "?"}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
          if (input.id) {
            const existing = s.agents.find((a) => a.id === input.id)!;
            const updated: Agent = { ...existing, ...input, id: existing.id, initials, campaignId: team?.campaignId ?? input.campaignId };
            const moved = existing.teamId !== updated.teamId;
            set({
              agents: s.agents.map((a) => (a.id === updated.id ? updated : a)),
              // Today's sales follow the agent to the new team for consistent team totals.
              sales: moved ? s.sales.map((sl) => (sl.agentId === updated.id ? { ...sl, teamId: updated.teamId, campaignId: updated.campaignId } : sl)) : s.sales,
              activity: prependActivity(s.activity, [makeActivity("admin-change", `Agent ${updated.name} updated`)]),
            });
            return updated;
          }
          const agent: Agent = {
            ...input,
            id: uid("agt"),
            initials,
            campaignId: team?.campaignId ?? input.campaignId,
            hue: Math.floor(Math.random() * 360),
            joinedAt: new Date().toISOString(),
          };
          set({
            agents: [...s.agents, agent],
            history: { ...s.history, [agent.id]: Array.from({ length: 30 }, () => 0) },
            historySubmitted: { ...s.historySubmitted, [agent.id]: Array.from({ length: 30 }, () => 0) },
            activity: prependActivity(s.activity, [makeActivity("admin-change", `Agent ${agent.name} added`)]),
          });
          return agent;
        },

        setAgentActive: (agentId, active) => {
          const s = get();
          set({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, active } : a)) });
        },

        upsertTeam: (input) => {
          const s = get();
          if (input.id) {
            const updated = { ...s.teams.find((t) => t.id === input.id)!, ...input } as Team;
            set({
              teams: s.teams.map((t) => (t.id === updated.id ? updated : t)),
              agents: s.agents.map((a) => (a.teamId === updated.id ? { ...a, campaignId: updated.campaignId } : a)),
              activity: prependActivity(s.activity, [makeActivity("admin-change", `Team ${updated.name} updated`)]),
            });
            return updated;
          }
          const team: Team = { ...input, id: uid("team") };
          set({
            teams: [...s.teams, team],
            activity: prependActivity(s.activity, [makeActivity("admin-change", `Team ${team.name} created`)]),
          });
          return team;
        },

        assignAgentsToTeam: (teamId, agentIds) => {
          const s = get();
          const team = s.teams.find((t) => t.id === teamId);
          if (!team) return;
          const ids = new Set(agentIds);
          set({
            agents: s.agents.map((a) => (ids.has(a.id) ? { ...a, teamId, campaignId: team.campaignId } : a)),
            sales: s.sales.map((sl) => (ids.has(sl.agentId) ? { ...sl, teamId, campaignId: team.campaignId } : sl)),
            activity: prependActivity(s.activity, [makeActivity("admin-change", `${agentIds.length} agent(s) assigned to ${team.name}`)]),
          });
        },

        upsertTargetRule: (input) => {
          const s = get();
          const clean = {
            ...input,
            salesPerSpin: Math.max(1, Math.floor(input.salesPerSpin)),
            teamDailyTarget: Math.max(1, Math.floor(input.teamDailyTarget)),
            agentDailyTarget: Math.max(1, Math.floor(input.agentDailyTarget)),
          };
          const existing = input.id
            ? s.targetRules.find((r) => r.id === input.id)
            : s.targetRules.find((r) => r.teamId === input.teamId);
          const rule: TargetRule = existing ? { ...existing, ...clean, id: existing.id } : { ...clean, id: uid("rule") };
          set({
            targetRules: existing ? s.targetRules.map((r) => (r.id === rule.id ? rule : r)) : [...s.targetRules, rule],
            activity: prependActivity(s.activity, [makeActivity("admin-change", `Target rule updated (${rule.salesPerSpin} sales per spin, ${rule.period})`)]),
          });
          return rule;
        },

        deleteTargetRule: (ruleId) => {
          const s = get();
          const rule = s.targetRules.find((r) => r.id === ruleId);
          if (!rule || rule.teamId === null) return; // default rule cannot be removed
          set({ targetRules: s.targetRules.filter((r) => r.id !== ruleId) });
        },

        upsertReward: (input) => {
          const s = get();
          let next: Reward[];
          let reward: Reward;
          if (input.id) {
            const existing = s.rewards.find((r) => r.id === input.id);
            if (!existing) return { ok: false, message: "Reward not found." };
            reward = { ...existing, ...input, id: existing.id, title: input.title.trim() };
            next = s.rewards.map((r) => (r.id === reward.id ? reward : r));
          } else {
            reward = { ...input, title: input.title.trim(), id: uid("rw"), order: s.rewards.length };
            next = [...s.rewards, reward];
          }
          const check = validateWheel(next);
          if (!check.valid) return { ok: false, message: check.message };
          set({
            rewards: next,
            activity: prependActivity(s.activity, [makeActivity("admin-change", `Reward "${reward.title}" saved`)]),
          });
          return { ok: true, reward };
        },

        deleteReward: (rewardId) => {
          const s = get();
          const next = s.rewards.filter((r) => r.id !== rewardId).map((r, i) => ({ ...r, order: i }));
          const check = validateWheel(next);
          if (!check.valid) return { ok: false, message: check.message };
          set({ rewards: next });
          return { ok: true };
        },

        reorderRewards: (ids) => {
          const s = get();
          const pos = new Map(ids.map((id, i) => [id, i]));
          set({
            rewards: [...s.rewards]
              .map((r) => ({ ...r, order: pos.get(r.id) ?? r.order + ids.length }))
              .sort((a, b) => a.order - b.order)
              .map((r, i) => ({ ...r, order: i })),
          });
        },

        logActivity: (type, message, extra) => {
          set({ activity: prependActivity(get().activity, [makeActivity(type, message, extra)]) });
        },

        markSynced: () => set({ lastSyncAt: new Date().toISOString() }),

        resetDemo: () => {
          if (get().liveMode) return;
          set({ ...createSeedData() });
          arenaBus.emit("data:reset", {});
        },

        syncRealData: ({ agents, sales, summary, mode }) => {
          const s = get();
          const patch: Partial<ArenaData> = {
            lastSyncAt: new Date().toISOString(),
            apiSyncStatus: "connected",
            apiSyncError: null,
          };
          if (mode) patch.dataSourceMode = mode;
          if (summary) patch.safeQuoteSummary = summary;
          // Live mode: the API result replaces the roster and sales even when empty (an empty day is real).
          if (agents && (agents.length > 0 || s.liveMode)) patch.agents = agents;
          if (sales) patch.sales = sales;
          set(patch);
        },

        setApiStatus: (status, error = null) => {
          set({ apiSyncStatus: status, apiSyncError: error });
        },

        setDataSourceMode: (mode) => {
          set({ dataSourceMode: mode });
        },

        setPeriodMetrics: (period, metrics) => {
          const s = get();
          const existing = s.periodMetrics ?? {
            day: { summary: null, closers: [], sales: [], dateRange: { from: "", to: "", label: "Today", detailedLabel: "" }, status: "idle", lastFetchedAt: null },
            week: { summary: null, closers: [], sales: [], dateRange: { from: "", to: "", label: "This Week", detailedLabel: "" }, status: "idle", lastFetchedAt: null },
            month: { summary: null, closers: [], sales: [], dateRange: { from: "", to: "", label: "This Month", detailedLabel: "" }, status: "idle", lastFetchedAt: null },
          };

          const updatedPeriod: PeriodMetrics = {
            ...existing[period],
            ...metrics,
            lastFetchedAt: new Date().toISOString(),
          };

          set({
            periodMetrics: {
              ...existing,
              [period]: updatedPeriod,
            },
          });
        },

        setAllTimeMetrics: (data) => {
          const s = get();
          const existing = s.periodMetrics ?? {
            day: { summary: null, closers: [], sales: [], dateRange: { from: "", to: "", label: "Today", detailedLabel: "" }, status: "idle", lastFetchedAt: null },
            week: { summary: null, closers: [], sales: [], dateRange: { from: "", to: "", label: "This Week", detailedLabel: "" }, status: "idle", lastFetchedAt: null },
            month: { summary: null, closers: [], sales: [], dateRange: { from: "", to: "", label: "This Month", detailedLabel: "" }, status: "idle", lastFetchedAt: null },
          };

          set({
            periodMetrics: {
              ...existing,
              allTime: {
                summary: data.summary,
                closers: data.closers ?? existing.allTime?.closers ?? [],
              },
            },
          });
        },

        setServerSpinBalance: (balance) => {
          set({ serverSpinBalance: balance });
        },
      };
    },
    {
      name: DATA_STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? localStorage
          : {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            }
      ),
      skipHydration: true,
      partialize: (s) => pickData(s),
      migrate: () => initialData() as unknown as ArenaStore,
      onRehydrateStorage: () => (state) => {
        if (useArenaStore.getState().liveMode) return;
        state?.ensureFreshDay();
        useArenaStore.setState({ hydrated: true });
      },
    },
  ),
);

/** Read-only helpers for non-React code (providers, tests). */
export const arenaSelectors = {
  data: () => pickData(useArenaStore.getState()),
  ruleFor: (teamId: string) => ruleForTeam(useArenaStore.getState().targetRules, teamId),
};
