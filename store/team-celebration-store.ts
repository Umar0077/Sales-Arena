"use client";

import { create } from "zustand";
import type { CelebrationEvent } from "@/types";
import type { SaleTeamInfo } from "@/lib/teams/celebration";

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

interface State {
  /** True while the Teams Arena celebration layer is mounted on this display. */
  mounted: boolean;
  latest: StandingsSnapshot | null;
  queue: TeamCelebrationItem[];
  current: TeamCelebrationItem | null;
  seen: string[];
  setMounted: (v: boolean) => void;
  setLatest: (s: StandingsSnapshot | null) => void;
  /** False when this sale id was already queued or shown here (never replays). */
  enqueue: (item: TeamCelebrationItem) => boolean;
  next: () => TeamCelebrationItem | null;
  finish: () => void;
  /** Removes and returns everything still waiting (the layer is unmounting). */
  drain: () => TeamCelebrationItem[];
  clear: () => void;
}

export const useTeamCelebrationStore = create<State>()((set, get) => ({
  mounted: false,
  latest: null,
  queue: [],
  current: null,
  seen: [],
  setMounted: (mounted) => set({ mounted }),
  setLatest: (latest) => set({ latest }),
  enqueue: (item) => {
    const s = get();
    const id = item.event.id;
    if (s.seen.includes(id)) return false;
    let queue = [...s.queue, item];
    if (queue.length > TEAM_QUEUE_MAX) queue = queue.slice(queue.length - TEAM_QUEUE_MAX);
    set({ queue, seen: [...s.seen, id].slice(-SEEN_MAX) });
    return true;
  },
  next: () => {
    const s = get();
    if (s.current || !s.queue.length) return null;
    const [head, ...rest] = s.queue;
    set({ current: head, queue: rest });
    return head;
  },
  finish: () => set({ current: null }),
  drain: () => {
    const q = get().queue;
    set({ queue: [] });
    return q;
  },
  clear: () => set({ queue: [], current: null }),
}));
