"use client";

import { create } from "zustand";
import type { BonusAward } from "@/frontend/stores/rewards-store";

/** One popup. Several awards for the same agent and program are merged into one. */
export interface BonusAnnouncement {
  key: string;
  awards: BonusAward[];
  /** True for admin previews (nothing was awarded). */
  preview?: boolean;
}

interface BonusFlowState {
  queue: BonusAnnouncement[];
  active: BonusAnnouncement | null;
  /**
   * The popup that just finished is still animating out. Cleared by its exit-animation callback (RewardRuntime) or,
   * if that never arrives (hidden tab, stalled frame), by a safety timer. Teams Arena celebrations wait for it, so
   * a bonus fade-out and a team celebration are never on screen together (no fixed delay).
   */
  exiting: boolean;
  push: (a: BonusAnnouncement) => void;
  next: () => BonusAnnouncement | null;
  finish: () => void;
  exited: () => void;
  clear: () => void;
}

/** Merge rule: same agent + same program → one popup with the combined amount. */
export function enqueueAnnouncement(queue: BonusAnnouncement[], a: BonusAnnouncement): BonusAnnouncement[] {
  const head = a.awards[0];
  const i = queue.findIndex((q) => q.awards[0].agentId === head.agentId && q.awards[0].programId === head.programId);
  if (i < 0) return [...queue, a];
  const seen = new Set(queue[i].awards.map((x) => x.id));
  return queue.map((q, j) => (j === i ? { ...q, awards: [...q.awards, ...a.awards.filter((x) => !seen.has(x.id))] } : q));
}

export const useBonusFlowStore = create<BonusFlowState>()((set, get) => ({
  queue: [],
  active: null,
  exiting: false,
  push: (a) => set({ queue: enqueueAnnouncement(get().queue, a) }),
  next: () => {
    const s = get();
    if (s.active || !s.queue.length) return null;
    const [head, ...rest] = s.queue;
    set({ active: head, queue: rest });
    return head;
  },
  finish: () => set({ active: null, exiting: get().active !== null || get().exiting }),
  exited: () => set({ exiting: false }),
  clear: () => set({ queue: [], active: null, exiting: false }),
}));
