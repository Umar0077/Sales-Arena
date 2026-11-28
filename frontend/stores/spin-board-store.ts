"use client";

import { create } from "zustand";

export interface PendingSpinAgent {
  user_code: string;
  agent_id: string;
  name: string;
  available: number;
}

export interface InProgressSpin {
  spin_id: string;
  user_code: string;
  name: string;
  created_at: string;
}

export interface RecentSpinWinner {
  id: string;
  user_code: string;
  name: string;
  reward_title: string;
  reward_color: string;
  reward_icon: string;
  mode?: string;
  created_at: string;
}

interface SpinBoardState {
  pending: PendingSpinAgent[];
  inProgress: InProgressSpin[];
  winners: RecentSpinWinner[];
  pendingLoaded: boolean;
  winnersLoaded: boolean;
  lastPendingSyncAt: string | null;
  lastPendingError: string | null;
  pendingSyncCount: number;
  refreshPending: () => Promise<void>;
  refreshWinners: () => Promise<void>;
}

/**
 * Authoritative PostgreSQL-backed lists for:
 *  - agents with unconsumed pending spin credits & active in-progress spins (/api/arena/spin/pending)
 *  - recent completed spin prize winners (/api/arena/spin/recent-winners)
 */
export const useSpinBoardStore = create<SpinBoardState>()((set) => ({
  pending: [],
  inProgress: [],
  winners: [],
  pendingLoaded: false,
  winnersLoaded: false,
  lastPendingSyncAt: null,
  lastPendingError: null,
  pendingSyncCount: 0,
  refreshPending: async () => {
    try {
      const res = await fetch("/api/arena/spin/pending", { cache: "no-store", credentials: "same-origin" });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok && Array.isArray(j.pending)) {
        set((s) => ({
          pending: j.pending as PendingSpinAgent[],
          inProgress: Array.isArray(j.inProgress) ? (j.inProgress as InProgressSpin[]) : [],
          pendingLoaded: true,
          lastPendingSyncAt: new Date().toISOString(),
          lastPendingError: null,
          pendingSyncCount: s.pendingSyncCount + 1,
        }));
      } else {
        set({ lastPendingError: j?.error ?? `HTTP ${res.status}` });
      }
    } catch (err) {
      set({ lastPendingError: err instanceof Error ? err.message : "Network error" });
    }
  },
  refreshWinners: async () => {
    try {
      const res = await fetch("/api/arena/spin/recent-winners", { cache: "no-store", credentials: "same-origin" });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok && Array.isArray(j.winners)) {
        set({ winners: j.winners as RecentSpinWinner[], winnersLoaded: true });
      }
    } catch {
      // Keep last verified state on transient network error
    }
  },
}));
