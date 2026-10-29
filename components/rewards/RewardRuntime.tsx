"use client";

import { useEffect } from "react";
import { AnimatePresence } from "motion/react";
import { useRewardsStore, type BonusAward } from "@/store/rewards-store";
import { useBonusFlowStore } from "@/store/bonus-flow-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { useCelebrationStore } from "@/store/celebration-store";
import { useArenaStore } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { useArenaModeStore } from "@/store/arena-mode-store";
import { arenaBus } from "@/lib/events/bus";
import { useReducedMotion } from "@/lib/performance/reduced-motion";
import { BonusCelebration } from "./BonusCelebration";

const ANNOUNCED_KEY = "sales-arena:announced-awards";
/** Awards older than this are not announced (e.g. the TV was off). */
const ANNOUNCE_WINDOW_MS = 10 * 60_000;

function readAnnounced(): Set<string> | null {
  try {
    const raw = localStorage.getItem(ANNOUNCED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}
function writeAnnounced(ids: Set<string>) {
  try {
    localStorage.setItem(ANNOUNCED_KEY, JSON.stringify([...ids].slice(-800)));
  } catch {
    /* ignore */
  }
}

/**
 * Live Arena side of the reward programs:
 *  - announces newly recorded awards (from this tab or the admin tab) once each;
 *  - shows bonus popups one at a time, never over the spin journey;
 *  - follows "switch screen" requests from the Admin Panel.
 */
export function RewardRuntime() {
  const active = useBonusFlowStore((s) => s.active);
  const queueLength = useBonusFlowStore((s) => s.queue.length);
  const spinStage = useSpinFlowStore((s) => s.stage);
  const programs = useRewardsStore((s) => s.programs);
  const currency = useSettingsStore((s) => s.currencyLabel);
  const reducedMotion = useReducedMotion();
  const agent = useArenaStore((s) => s.agents.find((a) => a.id === active?.awards[0].agentId));
  const team = useArenaStore((s) => s.teams.find((t) => t.id === agent?.teamId));

  // Announce new awards.
  useEffect(() => {
    const check = () => {
      const st = useRewardsStore.getState();
      if (!st.hydrated) return;
      const known = readAnnounced();
      if (!known) {
        // First run on this display: everything so far counts as announced.
        writeAnnounced(new Set(st.awards.map((a) => a.id)));
        return;
      }
      const fresh = st.awards.filter((a) => !known.has(a.id));
      if (!fresh.length) return;
      fresh.forEach((a) => known.add(a.id));
      writeAnnounced(known);
      const now = Date.now();
      const groups = new Map<string, BonusAward[]>();
      // Oldest first; for one sale that hits several programs: daily, then weekly, then monthly.
      const order = { daily: 0, weekly: 1, monthly: 2 } as const;
      const sorted = [...fresh].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || order[x.kind] - order[y.kind]);
      for (const a of sorted) {
        const program = st.programs.find((p) => p.id === a.programId);
        if (!program?.enabled || now - new Date(a.createdAt).getTime() > ANNOUNCE_WINDOW_MS) continue;
        const key = `${a.agentId}|${a.programId}`;
        groups.set(key, [...(groups.get(key) ?? []), a]);
      }
      groups.forEach((awards, key) => useBonusFlowStore.getState().push({ key, awards }));
    };
    check();
    const unsub = useRewardsStore.subscribe(check);
    return unsub;
  }, []);

  // Admin → "Switch Live Arena screen".
  useEffect(() => arenaBus.on("arena:mode", ({ mode }) => useArenaModeStore.getState().setPicked(mode)), []);

  // When the admin changes the default screen, displays follow it.
  useEffect(
    () =>
      useSettingsStore.subscribe((s, prev) => {
        if (s.defaultArenaMode !== prev.defaultArenaMode) useArenaModeStore.getState().setPicked(null);
      }),
    [],
  );

  // Show the next popup when nothing else is on screen.
  useEffect(() => {
    if (active || queueLength === 0 || spinStage !== "idle") return;
    const t = setTimeout(() => {
      if (useSpinFlowStore.getState().stage === "idle") useBonusFlowStore.getState().next();
    }, 400);
    return () => clearTimeout(t);
  }, [active, queueLength, spinStage]);

  // Hold normal sale toasts while a bonus popup is up.
  useEffect(() => {
    if (!active) return;
    useCelebrationStore.getState().pause();
    return () => useCelebrationStore.getState().resume();
  }, [active]);

  return (
    <AnimatePresence>
      {active && (
        <BonusCelebration
          key={active.key + active.awards.length}
          awards={active.awards}
          program={programs.find((p) => p.id === active.awards[0].programId)}
          agent={agent}
          team={team}
          currency={currency}
          reducedMotion={reducedMotion}
          onDone={() => useBonusFlowStore.getState().finish()}
        />
      )}
    </AnimatePresence>
  );
}
