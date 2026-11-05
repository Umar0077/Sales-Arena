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
import { useTeamCelebrationStore } from "@/store/team-celebration-store";
import { arenaBus } from "@/lib/events/bus";
import { noteReceived, noteShown } from "@/lib/live/latency";
import { serverOffsetMs } from "@/lib/live/sync-check";
import { useReducedMotion } from "@/lib/performance/reduced-motion";
import { BonusCelebration } from "./BonusCelebration";
import type { DisplaySettings } from "@/types";

const ANNOUNCED_KEY = "sales-arena:announced-awards";
/** Awards older than this are not announced (e.g. the TV was off, or its stream was down). */
const ANNOUNCE_WINDOW_MS = 10 * 60_000;

/** When this display opened. Live awards created before it are history, never re-announced. */
const LOADED_AT = Date.now();

/** Admin announcement switches: Live Arena on, popups on, category + program visible, cash/prize allowed. */
export function canAnnounce(
  a: Pick<BonusAward, "kind" | "announce" | "rewardType">,
  s: Pick<DisplaySettings, "arenaEnabled" | "celebrationPopups" | "rewardCategories" | "announceCash" | "announcePrizes">,
): boolean {
  if (!s.arenaEnabled || !s.celebrationPopups || a.announce === false) return false;
  if (!s.rewardCategories?.[a.kind]?.showOnArena) return false;
  return (a.rewardType ?? "cash") === "cash" ? s.announceCash : s.announcePrizes;
}

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
  // Teams Arena: a team sale celebration already on screen finishes first (a few seconds); waiting ones never
  // start while a bonus is queued or open, so the bonus keeps its priority and the two never overlap.
  const teamBusy = useTeamCelebrationStore((s) => s.current !== null);
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
      const known = readAnnounced() ?? (useArenaStore.getState().liveMode ? new Set<string>() : null);
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
      const live = useArenaStore.getState().liveMode;
      const s = useSettingsStore.getState();
      for (const a of sorted) {
        if (live) {
          // Server awards: only ones created after this display opened (a refresh never replays history)
          // and within the recovery window (a long disconnection never replays a backlog), on the server
          // clock, and only when the admin allows the announcement right now.
          const created = new Date(a.createdAt).getTime();
          const serverNow = now + serverOffsetMs();
          if (created < LOADED_AT + serverOffsetMs() || serverNow - created > ANNOUNCE_WINDOW_MS || !canAnnounce(a, s)) continue;
          // Delivery timeline: a live event already noted it; otherwise the background sync recovered it.
          noteReceived({ kind: "award", key: a.id, storedAt: a.createdAt, via: "sync" });
        } else {
          const program = st.programs.find((p) => p.id === a.programId);
          if (!program?.enabled || now - new Date(a.createdAt).getTime() > ANNOUNCE_WINDOW_MS) continue;
        }
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

  // A changed default screen applies to newly opened displays only; open displays move only
  // when the admin uses "Switch the Live Arena now" (lib/live/config-sync.ts).

  // Show the next popup when nothing else is on screen.
  useEffect(() => {
    if (active || queueLength === 0 || spinStage !== "idle" || teamBusy) return;
    const t = setTimeout(() => {
      if (useSpinFlowStore.getState().stage === "idle" && !useTeamCelebrationStore.getState().current) useBonusFlowStore.getState().next();
    }, 400);
    return () => clearTimeout(t);
  }, [active, queueLength, spinStage, teamBusy]);

  // Safety net: a bonus popup never stays up (and holds the queues) past its time, even if its own timer
  // was lost (throttled tab, interrupted animation). Normally BonusCelebration ends it first.
  useEffect(() => {
    if (!active) return;
    const secs = Math.min(30, Math.max(3, programs.find((p) => p.id === active.awards[0].programId)?.popupSeconds ?? 8));
    const t = setTimeout(() => {
      if (useBonusFlowStore.getState().active === active) useBonusFlowStore.getState().finish();
    }, (secs + 15) * 1000);
    return () => clearTimeout(t);
  }, [active, programs]);

  // Hold normal sale toasts while a bonus popup is up.
  useEffect(() => {
    if (!active) return;
    active.awards.forEach((a) => noteShown("award", a.id)); // delivery timeline
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
