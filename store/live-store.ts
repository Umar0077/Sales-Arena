"use client";

import { create } from "zustand";
import type { TargetPeriod } from "@/lib/live/targets";

/**
 * Live-data runtime state (never persisted): whether this server runs on live Safe Quote
 * data, the configured targets from PostgreSQL, and the manual refresh state.
 */
interface LiveState {
  /** null until the server has said which mode it runs in. */
  live: boolean | null;
  targets: Record<TargetPeriod, number | null>;
  targetsLoaded: boolean;
  /** Bumped by the refresh button; LiveApiSync runs one coordinated re-fetch per bump. */
  refreshRequest: number;
  refreshing: boolean;
  refreshError: string | null;
  lastSuccessAt: string | null;
  /** PostgreSQL prize catalog revision currently on this display's wheel. */
  catalogRevision: string | null;
  catalogSyncedAt: string | null;
  setCatalogRevision: (revision: string, at: string) => void;
  /** Admin's global performance policy as last received from the server (null = not known yet). */
  globalDisplay: { performanceMode: string; revision: number } | null;
  setGlobalDisplay: (d: { performanceMode: string; revision: number }) => void;
  setLive: (live: boolean) => void;
  setTargets: (t: Record<TargetPeriod, number | null>) => void;
  requestRefresh: () => void;
  setRefreshing: (v: boolean, error?: string | null) => void;
  markSuccess: () => void;
}

export const useLiveStore = create<LiveState>()((set, get) => ({
  live: null,
  targets: { day: null, week: null, month: null },
  targetsLoaded: false,
  refreshRequest: 0,
  refreshing: false,
  refreshError: null,
  lastSuccessAt: null,
  catalogRevision: null,
  catalogSyncedAt: null,
  setCatalogRevision: (catalogRevision, catalogSyncedAt) => set({ catalogRevision, catalogSyncedAt }),
  globalDisplay: null,
  setGlobalDisplay: (globalDisplay) => set({ globalDisplay }),
  setLive: (live) => set({ live }),
  setTargets: (targets) => set({ targets, targetsLoaded: true }),
  requestRefresh: () => {
    if (get().refreshing) return; // one refresh at a time
    set({ refreshRequest: get().refreshRequest + 1, refreshing: true, refreshError: null });
  },
  setRefreshing: (refreshing, error = null) => set({ refreshing, refreshError: error }),
  markSuccess: () => set({ lastSuccessAt: new Date().toISOString(), refreshError: null }),
}));
