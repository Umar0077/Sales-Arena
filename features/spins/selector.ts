import type { Reward, SpinResult } from "@/types";
import { hashString, mulberry32 } from "@/lib/utils";

/** Rewards that appear on the wheel, in display order. */
export function wheelRewards(rewards: Reward[]): Reward[] {
  return rewards.filter((r) => r.active).sort((a, b) => a.order - b.order);
}

export function issuedCounts(spins: SpinResult[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of spins) {
    if (s.status === "cancelled") continue;
    map.set(s.rewardId, (map.get(s.rewardId) ?? 0) + 1);
  }
  return map;
}

export function remainingStock(reward: Reward, issued: Map<string, number>): number | null {
  if (reward.quantity === null) return null;
  return Math.max(0, reward.quantity - (issued.get(reward.id) ?? 0));
}

export function isSelectable(reward: Reward, issued: Map<string, number>): boolean {
  if (!reward.active || reward.weight <= 0) return false;
  const left = remainingStock(reward, issued);
  return left === null || left > 0;
}

/**
 * Simulated (demo) reward selector — weighted random among in-stock active rewards.
 * In production the server selects the reward; the wheel only animates to it.
 */
export function selectReward(rewards: Reward[], issued: Map<string, number>, random: () => number): Reward | null {
  const eligible = wheelRewards(rewards).filter((r) => isSelectable(r, issued));
  if (eligible.length === 0) return null;
  const total = eligible.reduce((t, r) => t + r.weight, 0);
  let roll = random() * total;
  for (const r of eligible) {
    roll -= r.weight;
    if (roll < 0) return r;
  }
  return eligible[eligible.length - 1];
}

/** Deterministic RNG for seeded-test mode: same seed + agent + spin number → same result. */
export function seededRandom(seed: number, agentId: string, spinNumber: number): () => number {
  return mulberry32((seed >>> 0) ^ hashString(`${agentId}:${spinNumber}`));
}
