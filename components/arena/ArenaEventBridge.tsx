"use client";

import { useEffect } from "react";
import { arenaBus } from "@/lib/events/bus";
import { useArenaStore, pickData } from "@/store/arena-store";
import { useCelebrationStore } from "@/store/celebration-store";
import { useSettingsStore } from "@/store/settings-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { computeAllCredits } from "@/features/targets/eligibility";
import { dayKey } from "@/lib/utils";
import type { ArenaData } from "@/lib/mock-api/schema";

const ANNOUNCED_KEY = "sales-arena:announced-spins";

interface Announced {
  day: string;
  /** Fingerprint of the target rules; a rule change re-baselines silently. */
  rules: string;
  /** Spins already announced per agent: [earned from sales, bonus]. */
  granted: Record<string, [number, number]>;
}

function readAnnounced(): Announced | null {
  try {
    const raw = localStorage.getItem(ANNOUNCED_KEY);
    return raw ? (JSON.parse(raw) as Announced) : null;
  } catch {
    return null;
  }
}

function writeAnnounced(a: Announced): void {
  try {
    localStorage.setItem(ANNOUNCED_KEY, JSON.stringify(a));
  } catch {
    /* storage unavailable: popups still work for this session */
  }
}

/**
 * Finds agents who now have more spins than the Live Arena has announced and
 * returns them. Works no matter which tab recorded the sale, and survives reloads.
 */
export function detectNewUnlocks(
  data: ArenaData,
  prev: Announced | null,
): { next: Announced; unlocks: Array<{ agentId: string; periodSales: number; available: number; reason: "target" | "bonus" }> } {
  const credits = computeAllCredits(data);
  const rules = JSON.stringify(data.targetRules.map((r) => [r.teamId, r.salesPerSpin, r.period, r.enabled]));
  const granted: Record<string, [number, number]> = {};
  credits.forEach((c, id) => (granted[id] = [c.earned, c.bonus]));
  const next: Announced = { day: data.dayKey || dayKey(), rules, granted };

  // First run today, or rules changed: take a silent baseline.
  if (!prev || prev.day !== next.day || prev.rules !== rules) return { next, unlocks: [] };

  const unlocks: Array<{ agentId: string; periodSales: number; available: number; reason: "target" | "bonus" }> = [];
  credits.forEach((c, id) => {
    const [prevEarned, prevBonus] = Array.isArray(prev.granted[id]) ? prev.granted[id] : [c.earned, c.bonus];
    const moreEarned = c.earned > prevEarned;
    if ((moreEarned || c.bonus > prevBonus) && c.available > 0) {
      unlocks.push({ agentId: id, periodSales: c.periodSales, available: c.available, reason: moreEarned ? "target" : "bonus" });
    }
    // High-water mark: a validated sale that is rejected and validated again
    // must not announce the same spin twice.
    next.granted[id] = [Math.max(c.earned, prevEarned), Math.max(c.bonus, prevBonus)];
  });
  return { next, unlocks };
}

/** Wires store changes and bus events to the Live Arena's celebrations and spin flow. */
export function ArenaEventBridge() {
  useEffect(() => {
    const check = () => {
      const s = useArenaStore.getState();
      if (!s.hydrated) return;
      const settings = useSettingsStore.getState();
      const { next, unlocks } = detectNewUnlocks(pickData(s), readAnnounced());
      writeAnnounced(next);
      if (!settings.spinFeatureEnabled || !settings.spinFlowEnabled) return;
      const push = useSpinFlowStore.getState().push;
      for (const u of unlocks) push(u);
    };
    check();
    const unsubStore = useArenaStore.subscribe(check);

    const offCelebrate = arenaBus.on("celebration:enqueue", ({ event }) => {
      const st = useSettingsStore.getState();
      const flowHandlesSpin = st.spinFeatureEnabled && st.spinFlowEnabled;
      if (event.tier === "spin-unlocked" && flowHandlesSpin) return;
      if (event.tier === "sale" && st.saleCelebrationStyle === "off") return;
      if (event.tier === "milestone" && !st.announceMilestones) return;
      if (event.tier === "team-target" && !st.announceTeamTargets) return;
      useCelebrationStore.getState().enqueue(event);
    });

    const offLaunch = arenaBus.on("spin:launch", ({ agentId }) => {
      if (!useSettingsStore.getState().spinFeatureEnabled) return;
      useSpinFlowStore.getState().push({ agentId, periodSales: 0, available: 0, reason: "launch" });
    });

    // "/?spin=<agentId>" opens the spin stage directly (Admin → Launch spin).
    const params = new URLSearchParams(window.location.search);
    const launchId = params.get("spin");
    if (launchId) {
      useSpinFlowStore.getState().push({ agentId: launchId, periodSales: 0, available: 0, reason: "launch" });
      window.history.replaceState(null, "", window.location.pathname);
    }

    return () => {
      unsubStore();
      offCelebrate();
      offLaunch();
    };
  }, []);

  return null;
}
