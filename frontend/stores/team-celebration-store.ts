"use client";

import { create } from "zustand";
import type { CelebrationEvent } from "@/shared/types";
import type { SaleTeamInfo } from "@/shared/teams/celebration";

/** Latest standings this display has (set by the Teams Arena screen). Used for routing and verified totals. */
export interface StandingsSnapshot {
  period: string;
  label: string;
  teams: ReadonlyArray<{ id: string; name: string; validated: number; logoUrl: string | null; color: string; accentSecondary: string | null }>;
}

export interface TeamCelebrationItem {
  /** The original sale event, unchanged (given back to the standard popup if this display leaves Teams Arena). */
  event: CelebrationEvent;
  team: SaleTeamInfo;
  /** The team's validated figure when the sale arrived (for a verified total), or null if unknown. */
  baseline: { period: string; validated: number } | null;
  enqueuedAt: number;
  /** Admin preview: never from live data, never recorded, shown only on the Admin's own screen. */
  preview?: boolean;
}

/** Bounded memory of ids already queued / shown on this display (dedupes stream + sync + other-tab echoes). */
const SEEN_MAX = 300;
/** Queue cap: a burst far above any real sales rate is folded, oldest first, after this many waiting. */
export const TEAM_QUEUE_MAX = 12;

/**
 * One celebration at a time, as an explicit state machine:
 *
 *   idle ──next()──▶ preparing ──play()──▶ playing ──finish()──▶ finishing ──exited()──▶ idle
 *                       │  (artwork + sound decoded,        (on screen,           (exit animation;
 *                       │   bounded wait)                    own timer)            confirmed by the
 *                       └──finish()──▶ idle (never shown: nothing to exit)        AnimatePresence callback,
 *                                                                                   or recovered after a timeout)
 *
 * The next celebration, a bonus popup or a sale card starts only from `idle`, so two full-screen celebrations are
 * never on screen together (no fixed delay: the exit animation's own completion releases the queue).
 */
export type TeamCelebrationPhase = "idle" | "preparing" | "playing" | "finishing";

export interface TeamCelebrationStats {
  queued: number;
  duplicates: number;
  started: number;
  completed: number;
  /** A stage that did not report back in time and was released by the safety timer (hidden tab, stalled frame). */
  recovered: number;
  /** Given back to the standard sale card (left Teams Arena, team archived while waiting). */
  handedBack: number;
}
const ZERO: TeamCelebrationStats = { queued: 0, duplicates: 0, started: 0, completed: 0, recovered: 0, handedBack: 0 };

interface State {
  /** True while the Teams Arena celebration layer is mounted on this display. */
  mounted: boolean;
  latest: StandingsSnapshot | null;
  queue: TeamCelebrationItem[];
  /** The item being prepared or shown (null when idle or finishing). */
  current: TeamCelebrationItem | null;
  phase: TeamCelebrationPhase;
  /** performance.now() when the current phase began. */
  phaseAt: number;
  seen: string[];
  stats: TeamCelebrationStats;
  /** Measured on this display: celebrations ran with poor frame pacing, so later ones use the Lite motion. */
  measuredLite: boolean;
  setMounted: (v: boolean) => void;
  setLatest: (s: StandingsSnapshot | null) => void;
  /** False when this sale id was already queued or shown here (never replays). */
  enqueue: (item: TeamCelebrationItem) => boolean;
  next: () => TeamCelebrationItem | null;
  play: () => void;
  finish: () => void;
  exited: (recovered?: boolean) => void;
  /** Removes and returns everything still waiting (the layer is unmounting). */
  drain: () => TeamCelebrationItem[];
  /** The layer unmounted: nothing is on screen any more, back to idle at once. */
  reset: () => void;
  setMeasuredLite: (v: boolean) => void;
  count: (k: keyof TeamCelebrationStats) => void;
  clear: () => void;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
function expose(s: TeamCelebrationStats, phase: TeamCelebrationPhase) {
  if (typeof window !== "undefined") (window as unknown as { __teamCelebration?: unknown }).__teamCelebration = { ...s, phase };
}

export const useTeamCelebrationStore = create<State>()((set, get) => {
  const go = (phase: TeamCelebrationPhase, patch: Partial<State> = {}, stat?: keyof TeamCelebrationStats) => {
    const stats = stat ? { ...get().stats, [stat]: get().stats[stat] + 1 } : get().stats;
    set({ ...patch, phase, phaseAt: now(), stats });
    expose(stats, phase);
  };
  return {
    mounted: false,
    latest: null,
    queue: [],
    current: null,
    phase: "idle",
    phaseAt: 0,
    seen: [],
    stats: { ...ZERO },
    measuredLite: false,
    setMounted: (mounted) => set({ mounted }),
    setLatest: (latest) => set({ latest }),
    enqueue: (item) => {
      const s = get();
      const id = item.event.id;
      if (s.seen.includes(id)) {
        get().count("duplicates");
        return false;
      }
      let queue = [...s.queue, item];
      if (queue.length > TEAM_QUEUE_MAX) queue = queue.slice(queue.length - TEAM_QUEUE_MAX);
      const stats = { ...s.stats, queued: s.stats.queued + 1 };
      set({ queue, seen: [...s.seen, id].slice(-SEEN_MAX), stats });
      expose(stats, s.phase);
      return true;
    },
    next: () => {
      const s = get();
      if (s.phase !== "idle" || !s.queue.length) return null;
      const [head, ...rest] = s.queue;
      go("preparing", { current: head, queue: rest });
      return head;
    },
    play: () => {
      if (get().phase === "preparing" && get().current) go("playing", {}, "started");
    },
    finish: () => {
      const p = get().phase;
      if (p === "playing") go("finishing", { current: null });
      else if (p === "preparing") go("idle", { current: null }); // never shown: nothing to exit
    },
    exited: (recovered = false) => {
      if (get().phase !== "finishing") return;
      go("idle", {}, recovered ? "recovered" : "completed");
      if (recovered) get().count("completed");
    },
    drain: () => {
      const q = get().queue;
      set({ queue: [] });
      return q;
    },
    reset: () => go("idle", { current: null }),
    setMeasuredLite: (measuredLite) => set({ measuredLite }),
    count: (k) => {
      const stats = { ...get().stats, [k]: get().stats[k] + 1 };
      set({ stats });
      expose(stats, get().phase);
    },
    clear: () => go("idle", { queue: [], current: null }),
  };
});

/** Busy = anything but idle (preparing, on screen, or still animating out). */
export const teamCelebrationBusy = (s: { phase: TeamCelebrationPhase }) => s.phase !== "idle";
