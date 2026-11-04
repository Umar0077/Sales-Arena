"use client";

import { create } from "zustand";
import type { TargetPeriod } from "@/lib/live/targets";

/**
 * Live-data runtime state (never persisted): whether this server runs on live Safe Quote
 * data, the configured targets from PostgreSQL, and the manual refresh state.
 */
export interface PeriodAwardSummary {
  periodKey: string;
  /** Cash earned (excludes cancelled / reversed). Earned is not paid. */
  earned: number;
  paid: number;
  count: number;
  currency: string;
}
export type AwardSummary = Record<"daily" | "weekly" | "monthly", PeriodAwardSummary>;
export interface AgentPeriodBonus {
  earned: number;
  count: number;
}
export interface AgentBonus {
  /** Currency of the active cash programs (used to label genuine zeros). */
  currency: string;
  byAgent: Record<string, { currency: string; day: AgentPeriodBonus; week: AgentPeriodBonus; month: AgentPeriodBonus }>;
}

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
  /** Earned cash bonuses for the current day / week / month (from bonus_awards). null = not loaded yet. */
  awardSummary: AwardSummary | null;
  /** Earned cash per agent (user code, upper case) for today / this week / this month, from bonus_awards. */
  agentBonus: AgentBonus | null;
  /** "error": the last load failed (keep showing the last verified values, or "unavailable"). */
  awardSummaryStatus: "loading" | "ok" | "error";
  setAwardSummary: (s: AwardSummary | null, status: "ok" | "error", agentBonus?: AgentBonus | null) => void;
  programsStatus: "loading" | "ok" | "error";
  setProgramsStatus: (s: "ok" | "error") => void;
  setLive: (live: boolean) => void;
  /**
   * Arena Cub public permission as last stated by the SERVER (arena.config → arenaCub.allowOnLiveArena):
   * "unknown" until this page has a server answer, then "on" / "off". Never read from browser storage,
   * never set by a failed request, so the public cub shows only when the server says so.
   */
  cubPermission: "unknown" | "on" | "off";
  setCubPermission: (p: "on" | "off") => void;
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
  awardSummary: null,
  awardSummaryStatus: "loading",
  agentBonus: null,
  setAwardSummary: (s, status, agentBonus) => set((st) => ({ awardSummary: s ?? st.awardSummary, awardSummaryStatus: status, agentBonus: agentBonus ?? st.agentBonus })),
  programsStatus: "loading",
  setProgramsStatus: (programsStatus) => set({ programsStatus }),
  refreshError: null,
  lastSuccessAt: null,
  catalogRevision: null,
  catalogSyncedAt: null,
  setCatalogRevision: (catalogRevision, catalogSyncedAt) => set({ catalogRevision, catalogSyncedAt }),
  globalDisplay: null,
  setGlobalDisplay: (globalDisplay) => set({ globalDisplay }),
  setLive: (live) => set({ live }),
  cubPermission: "unknown",
  setCubPermission: (cubPermission) => {
    if (get().cubPermission !== cubPermission) set({ cubPermission });
  },
  setTargets: (targets) => set({ targets, targetsLoaded: true }),
  requestRefresh: () => {
    if (get().refreshing) return; // one refresh at a time
    set({ refreshRequest: get().refreshRequest + 1, refreshing: true, refreshError: null });
  },
  setRefreshing: (refreshing, error = null) => set({ refreshing, refreshError: error }),
  markSuccess: () => set({ lastSuccessAt: new Date().toISOString(), refreshError: null }),
}));
