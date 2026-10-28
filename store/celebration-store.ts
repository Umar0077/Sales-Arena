"use client";

import { create } from "zustand";
import type { CelebrationEvent } from "@/types";
import { TIERS } from "@/features/celebrations/tiers";

export const MAX_QUEUE = 10;

export interface CelebrationState {
  queue: CelebrationEvent[];
  current: CelebrationEvent | null;
  paused: boolean;
  /** Standard sales folded into a summary because the queue overflowed. */
  collapsed: number;
  recent: CelebrationEvent[];
  enqueue: (event: CelebrationEvent) => void;
  advance: () => CelebrationEvent | null;
  finishCurrent: () => void;
  skip: () => void;
  pause: () => void;
  resume: () => void;
  clear: () => void;
}

/**
 * Inserts by priority: higher tiers jump ahead of queued standard sales, equal tiers stay FIFO.
 * When the queue is full the oldest lowest-priority item is dropped and counted.
 */
export function insertByPriority(queue: CelebrationEvent[], event: CelebrationEvent, max = MAX_QUEUE): { queue: CelebrationEvent[]; dropped: number } {
  const p = TIERS[event.tier].priority;
  let idx = queue.length;
  for (let i = 0; i < queue.length; i++) {
    if (TIERS[queue[i].tier].priority < p) {
      idx = i;
      break;
    }
  }
  const next = [...queue.slice(0, idx), event, ...queue.slice(idx)];
  let dropped = 0;
  while (next.length > max) {
    let lowest = 0;
    for (let i = 1; i < next.length; i++) {
      if (TIERS[next[i].tier].priority < TIERS[next[lowest].tier].priority) lowest = i;
    }
    next.splice(lowest, 1);
    dropped++;
  }
  return { queue: next, dropped };
}

export const useCelebrationStore = create<CelebrationState>()((set, get) => ({
  queue: [],
  current: null,
  paused: false,
  collapsed: 0,
  recent: [],
  enqueue: (event) => {
    const { queue, dropped } = insertByPriority(get().queue, event);
    set({ queue, collapsed: get().collapsed + dropped });
  },
  advance: () => {
    const s = get();
    if (s.current || s.paused || s.queue.length === 0) return null;
    const [next, ...rest] = s.queue;
    set({ current: next, queue: rest, recent: [next, ...s.recent].slice(0, 20) });
    return next;
  },
  finishCurrent: () => set({ current: null, collapsed: get().queue.length === 0 ? 0 : get().collapsed }),
  skip: () => set({ current: null }),
  pause: () => set({ paused: true }),
  resume: () => set({ paused: false }),
  clear: () => set({ queue: [], current: null, collapsed: 0 }),
}));
