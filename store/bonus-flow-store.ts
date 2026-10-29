"use client";

import { create } from "zustand";
import type { BonusAward } from "@/store/rewards-store";

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
  push: (a: BonusAnnouncement) => void;
  next: () => BonusAnnouncement | null;
  finish: () => void;
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
  push: (a) => set({ queue: enqueueAnnouncement(get().queue, a) }),
  next: () => {
    const s = get();
    if (s.active || !s.queue.length) return null;
    const [head, ...rest] = s.queue;
    set({ active: head, queue: rest });
    return head;
  },
  finish: () => set({ active: null }),
  clear: () => set({ queue: [], active: null }),
}));
