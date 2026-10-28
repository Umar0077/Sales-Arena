import type { SpinCredit, TargetPeriod, TargetRule } from "@/types";
import type { ArenaData } from "@/lib/mock-api/schema";
import { startOfDay } from "@/lib/utils";
import { leadCountsByAgent } from "@/features/sales/leads";

export const FALLBACK_RULE: TargetRule = {
  id: "rule_fallback",
  teamId: null,
  salesPerSpin: 3,
  period: "daily",
  enabled: true,
  teamDailyTarget: 100,
  agentDailyTarget: 8,
};

/** Team-specific rule if present, otherwise the default (teamId = null) rule. */
export function ruleForTeam(rules: TargetRule[], teamId: string | null | undefined): TargetRule {
  return (
    (teamId ? rules.find((r) => r.teamId === teamId) : undefined) ??
    rules.find((r) => r.teamId === null) ??
    FALLBACK_RULE
  );
}

export function periodStart(period: TargetPeriod, now: Date = new Date()): Date {
  const d = startOfDay(now);
  if (period === "weekly") d.setDate(d.getDate() - 6);
  return d;
}

/**
 * Validated (approved) sales today per agent — the only thing that earns spins.
 * Uses the shared lead counts, so pending, rejected and duplicate leads never count.
 */
export function approvedTodayByAgent(data: Pick<ArenaData, "sales">): Map<string, number> {
  const map = new Map<string, number>();
  leadCountsByAgent(data.sales).forEach((c, agentId) => c.validated > 0 && map.set(agentId, c.validated));
  return map;
}

/** Spins started (in-progress or completed, not cancelled) per agent since `since`. */
export function spinsUsedSince(data: Pick<ArenaData, "spins">, since: Date): Map<string, number> {
  const t = since.getTime();
  const map = new Map<string, number>();
  for (const s of data.spins) {
    if (s.status === "cancelled") continue;
    if (new Date(s.createdAt).getTime() >= t) map.set(s.agentId, (map.get(s.agentId) ?? 0) + 1);
  }
  return map;
}

export interface CreditContext {
  today: Map<string, number>;
  usedDaily: Map<string, number>;
  usedWeekly: Map<string, number>;
}

export function buildCreditContext(data: ArenaData, now: Date = new Date()): CreditContext {
  return {
    today: approvedTodayByAgent(data),
    usedDaily: spinsUsedSince(data, periodStart("daily", now)),
    usedWeekly: spinsUsedSince(data, periodStart("weekly", now)),
  };
}

/**
 * Spin credit calculation (single source of truth):
 *   earned    = floor(periodApprovedSales / salesPerSpin)   (0 when rule disabled)
 *   available = max(0, earned + bonus − used)
 */
export function computeSpinCredit(
  data: ArenaData,
  agentId: string,
  ctx: CreditContext = buildCreditContext(data),
): SpinCredit {
  const agent = data.agents.find((a) => a.id === agentId);
  const rule = ruleForTeam(data.targetRules, agent?.teamId);
  const today = ctx.today.get(agentId) ?? 0;
  const hist = data.history[agentId] ?? [];
  const periodSales =
    rule.period === "weekly" ? today + hist.slice(0, 6).reduce((t, n) => t + n, 0) : today;
  const perSpin = Math.max(1, Math.floor(rule.salesPerSpin));
  const earned = rule.enabled ? Math.floor(periodSales / perSpin) : 0;
  const bonus = data.bonusCredits[agentId] ?? 0;
  const used = (rule.period === "weekly" ? ctx.usedWeekly : ctx.usedDaily).get(agentId) ?? 0;
  return {
    agentId,
    earned,
    bonus,
    used,
    available: Math.max(0, earned + bonus - used),
    periodSales,
    salesPerSpin: perSpin,
    salesToNext: rule.enabled ? perSpin - (periodSales % perSpin) : null,
    ruleEnabled: rule.enabled,
  };
}

export function computeAllCredits(data: ArenaData, now: Date = new Date()): Map<string, SpinCredit> {
  const ctx = buildCreditContext(data, now);
  const map = new Map<string, SpinCredit>();
  for (const a of data.agents) map.set(a.id, computeSpinCredit(data, a.id, ctx));
  return map;
}

/** Preview helper for the target admin: how many credits would N sales earn under a rule. */
export function previewRule(rule: Pick<TargetRule, "salesPerSpin" | "enabled">, sales: number): number {
  if (!rule.enabled) return 0;
  return Math.floor(sales / Math.max(1, Math.floor(rule.salesPerSpin)));
}

export function teamTarget(data: Pick<ArenaData, "targetRules">, teamId: string): number {
  return ruleForTeam(data.targetRules, teamId).teamDailyTarget;
}
