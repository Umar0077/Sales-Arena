"use client";

import { useEffect } from "react";
import { arenaBus } from "@/frontend/events/bus";
import { useArenaStore, pickData } from "@/frontend/stores/arena-store";
import { useCelebrationStore } from "@/frontend/stores/celebration-store";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { useSpinFlowStore } from "@/frontend/stores/spin-flow-store";
import { computeAllCredits } from "@/frontend/features/targets/eligibility";
import { useTeamCelebrationStore } from "@/frontend/stores/team-celebration-store";
import { routeSale } from "@/shared/teams/celebration";
import { noteEnqueued } from "@/frontend/live/latency";
import type { CelebrationEvent } from "@/shared/types";
import { dayKey } from "@/shared/utils";
import type { ArenaData } from "@/shared/mock-api/schema";

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

const saleKey = (e: CelebrationEvent) => (e.id.startsWith("celeb_sale_") ? e.id.slice("celeb_sale_".length) : e.id);

/** Queues a live sale on the Teams Arena celebration layer when routing says so. True = handled here. */
export function routeTeamSale(event: CelebrationEvent, enabled: boolean): boolean {
  if (event.preview) return false;
  const team = useTeamCelebrationStore.getState();
  const decision = routeSale(event, {
    teamsScreen: team.mounted,
    enabled,
    competingTeamIds: team.latest ? new Set(team.latest.teams.map((t) => t.id)) : null,
  });
  if (decision.presentation !== "team" || !event.saleTeam) return false;
  const snap = team.latest?.teams.find((t) => t.id === event.saleTeam!.id);
  // A repeat of a sale already queued / shown here (stream + sync + another tab) is consumed silently.
  if (team.enqueue({ event, team: event.saleTeam, baseline: snap && team.latest ? { period: team.latest.period, validated: snap.validated } : null, enqueuedAt: Date.now() }))
    noteEnqueued("sale", saleKey(event), "team");
  return true;
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
      // Live mode: spin unlocks come only from the server (spin.unlocked, PostgreSQL ledger), never from local data.
      if (s.liveMode) return;
      if (!settings.spinFeatureEnabled || !settings.spinFlowEnabled || !settings.celebrationPopups || !settings.announceAutoSpins) return;
      const push = useSpinFlowStore.getState().push;
      for (const u of unlocks) push(u);
    };
    check();
    const unsubStore = useArenaStore.subscribe(check);

    const offCelebrate = arenaBus.on("celebration:enqueue", ({ event }) => {
      const st = useSettingsStore.getState();
      // Screen-aware presentation: on Teams Arena a sale of a competing team plays that team's celebration
      // INSTEAD of the sale card (one presentation per sale per display). Every other screen, and any sale
      // that cannot be attributed safely, keeps the existing sale card below, unchanged.
      if (routeTeamSale(event, st.teamSaleCelebrations !== false)) return;
      if (event.tier === "sale") noteEnqueued("sale", saleKey(event), "standard");
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
    if (launchId && useSettingsStore.getState().spinFeatureEnabled) {
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
