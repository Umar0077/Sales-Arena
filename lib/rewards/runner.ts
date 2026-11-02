"use client";

import { useArenaStore, pickData } from "@/store/arena-store";
import { useRewardsStore, type BonusKind } from "@/store/rewards-store";
import { useSettingsStore } from "@/store/settings-store";
import { browserTimezone, type BusinessClock } from "@/lib/time/business";
import { evaluateAwards, formatReward } from "./engine";
import type { DisplaySettings } from "@/types";

export function businessClock(s: Pick<DisplaySettings, "businessTimezone" | "weekStartDay">): BusinessClock {
  return { timezone: s.businessTimezone || browserTimezone(), weekStartDay: s.weekStartDay };
}

/** Program kinds that may award: categories switched to Program Active in Admin → Reward Programs. */
export function allowedKinds(s: Pick<DisplaySettings, "rewardCategories">): (k: BonusKind) => boolean {
  return (k) => s.rewardCategories?.[k]?.active !== false;
}

/**
 * Called for a validated sale recorded in THIS tab. Awards are written once to the
 * shared reward store; other tabs (the TV) pick them up through storage sync.
 */
export function processValidatedSale(agentId: string): void {
  const settings = useSettingsStore.getState();
  const rewards = useRewardsStore.getState();
  const arena = useArenaStore.getState();
  const fresh = evaluateAwards(pickData(arena), rewards.programs, rewards.awards, agentId, {
    clock: businessClock(settings),
    allowed: allowedKinds(settings),
  });
  if (!fresh.length) return;
  const added = rewards.recordAwards(fresh);
  for (const a of added) {
    arena.logActivity("bonus-awarded", `${a.agentName} earned ${formatReward(a.amount, a.prizeLabel, settings.currencyLabel)} · ${a.programName}`, {
      agentId: a.agentId,
    });
  }
}
