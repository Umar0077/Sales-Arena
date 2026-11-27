"use client";

import { create } from "zustand";

export interface PendingSpinAgent {
  user_code: string;
  agent_id: string;
  name: string;
  available: number;
}

export interface RecentSpinWinner {
  id: string;
  user_code: string;
  name: string;
  reward_title: string;
  reward_color: string;
  reward_icon: string;
  created_at: string;
}

interface SpinBoardState {
  pending: PendingSpinAgent[];
  winners: RecentSpinWinner[];
  pendingLoaded: boolean;
  winnersLoaded: boolean;
  refreshPending: () => Promise<void>;
  refreshWinners: () => Promise<void>;
}

/**
 * Authoritative PostgreSQL-backed lists for:
 *  - agents with unconsumed pending spin credits (/api/arena/spin/pending)
 *  - recent completed spin prize winners (/api/arena/spin/recent-winners)
 */
export const useSpinBoardStore = create<SpinBoardState>()((set) => ({
  pending: [],
  winners: [],
  pendingLoaded: false,
  winnersLoaded: false,
  refreshPending: async () => {
    try {
      const res = await fetch("/api/arena/spin/pending", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok && Array.isArray(j.pending)) {
        set({ pending: j.pending as PendingSpinAgent[], pendingLoaded: true });
      }
    } catch {
      // Keep last verified state on transient network error
    }
  },
  refreshWinners: async () => {
    try {
      const res = await fetch("/api/arena/spin/recent-winners", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok && Array.isArray(j.winners)) {
        set({ winners: j.winners as RecentSpinWinner[], winnersLoaded: true });
      }
    } catch {
      // Keep last verified state on transient network error
    }
  },
}));
