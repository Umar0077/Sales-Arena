import type { ArenaData } from "@/lib/mock-api/schema";
import type { BonusAward, BonusKind, BonusProgram } from "@/store/rewards-store";
import { periodLeadCounts, leadCountsByAgent } from "@/features/sales/leads";
import { periodInfo, withinDates, type BusinessClock, type RewardPeriod } from "@/lib/time/business";

/**
 * Bonus award engine (demo / client side).
 *
 * Runs when a validated sale event arrives for an agent and returns the awards
 * that agent has newly earned. Rules:
 *  - only validated (approved) sales count, via the shared lead counts;
 *  - one award per `salesRequired` validated sales in the period, up to `maxAwards`;
 *  - award ids are deterministic, so repeated or duplicate events never double-award;
 *  - existing awards are never recalculated or removed when a program changes.
 * In production this must run on the backend; the UI only displays server awards.
 */

export const KIND_PERIOD: Record<BonusKind, RewardPeriod> = { daily: "day", weekly: "week", monthly: "month" };

export function awardId(programId: string, agentId: string, periodKey: string, n: number): string {
  return `${programId}|${agentId}|${periodKey}|${n}`;
}

export interface EvaluateOptions {
  clock: BusinessClock;
  /** Program kinds allowed to award right now (concurrency setting). */
  allowed: (kind: BonusKind) => boolean;
  now?: Date;
}

export function evaluateAwards(
  data: Pick<ArenaData, "sales" | "history" | "historySubmitted" | "agents">,
  programs: BonusProgram[],
  existing: BonusAward[],
  agentId: string,
  opts: EvaluateOptions,
): BonusAward[] {
  const agent = data.agents.find((a) => a.id === agentId);
  if (!agent) return [];
  const now = opts.now ?? new Date();
  const out: BonusAward[] = [];

  for (const program of programs) {
    if (!program.enabled || !opts.allowed(program.kind)) continue;
    const info = periodInfo(KIND_PERIOD[program.kind], opts.clock, now);
    if (!withinDates(info.today, program.startDate, program.endDate)) continue;

    // Daily: only sales validated after the campaign was switched on. Weekly/monthly: the whole period.
    const since = program.kind === "daily" && program.activeSince ? program.activeSince : null;
    const validated = since
      ? leadCountsByAgent(data.sales.filter((s) => s.agentId === agentId && (s.approvedAt ?? s.createdAt) >= since)).get(agentId)?.validated ?? 0
      : periodLeadCounts(data, info.daysBack).get(agentId)?.validated ?? 0;
    const earned = Math.min(program.maxAwards, Math.floor(validated / Math.max(1, program.salesRequired)));
    const already = existing.filter((a) => a.programId === program.id && a.agentId === agentId && a.periodKey === info.key);
    const have = already.reduce((m, a) => Math.max(m, a.n), 0);

    for (let n = have + 1; n <= earned; n++) {
      out.push({
        id: awardId(program.id, agentId, info.key, n),
        programId: program.id,
        kind: program.kind,
        agentId,
        agentName: agent.name,
        periodKey: info.key,
        n,
        validatedAtAward: since ? (leadCountsByAgent(data.sales).get(agentId)?.validated ?? validated) : validated,
        amount: program.amount,
        prizeLabel: program.prizeLabel,
        programName: program.name,
        salesRequired: program.salesRequired,
        createdAt: now.toISOString(),
      });
    }
  }
  return out;
}

/** "Rs. 1,000" or the prize label. */
export function formatReward(amount: number, prizeLabel: string, currency: string): string {
  if (amount > 0) return `${currency} ${amount.toLocaleString("en-US")}`.trim();
  return prizeLabel || "a reward";
}
