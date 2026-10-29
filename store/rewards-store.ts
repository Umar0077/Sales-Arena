"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SoundCategory } from "@/types";

export const REWARDS_STORAGE_KEY = "sales-arena:reward-programs";

export type BonusKind = "daily" | "weekly" | "monthly";

/** A daily / weekly / monthly bonus campaign. Independent from Spin & Win. */
export interface BonusProgram {
  id: string;
  kind: BonusKind;
  name: string;
  enabled: boolean;
  /** Validated sales needed for one award, e.g. 1 (daily) or 10 (weekly). */
  salesRequired: number;
  /** Cash bonus per award (0 when the reward is a prize). */
  amount: number;
  /** Optional non-cash reward, e.g. "Movie tickets". */
  prizeLabel: string;
  /** Most awards one agent can earn in one period (the "reward limit"). */
  maxAwards: number;
  /** Optional campaign window, inclusive (YYYY-MM-DD in business time). */
  startDate: string | null;
  endDate: string | null;
  /** Popup templates: {agent}, {amount}, {sales}, {program}, {count}. */
  headline: string;
  message: string;
  rewardLine: string;
  sound: SoundCategory;
  /** Accent colour of the popup and program cards. */
  accent: string;
  /** Seconds the popup stays up. */
  popupSeconds: number;
  /** Rows on this arena's leaderboard (weekly/monthly). */
  leaderboardCount: number;
  /**
   * When the campaign was switched on. Daily bonuses count only sales validated after
   * this, so turning a campaign on mid-day doesn't pay out for earlier sales.
   */
  activeSince: string | null;
}

/** A granted bonus. Keeps a snapshot so history survives program edits. */
export interface BonusAward {
  /** Deterministic: program | agent | period | award number. Makes awards idempotent. */
  id: string;
  programId: string;
  kind: BonusKind;
  agentId: string;
  agentName: string;
  periodKey: string;
  /** 1st, 2nd … award for this agent in this period. */
  n: number;
  validatedAtAward: number;
  amount: number;
  prizeLabel: string;
  programName: string;
  salesRequired: number;
  createdAt: string;
}

export const DEFAULT_PROGRAMS: BonusProgram[] = [
  {
    id: "prog_daily",
    kind: "daily",
    name: "Daily Validation Bonus",
    enabled: true,
    salesRequired: 1,
    amount: 1000,
    prizeLabel: "",
    maxAwards: 10,
    startDate: null,
    endDate: null,
    headline: "CONGRATULATIONS, {agent}!",
    message: "YOUR SALE HAS BEEN VALIDATED!",
    rewardLine: "YOU'VE EARNED {amount} DAILY BONUS!",
    sound: "target",
    accent: "#FFC857",
    popupSeconds: 6,
    leaderboardCount: 10,
    activeSince: null,
  },
  {
    id: "prog_weekly",
    kind: "weekly",
    name: "Weekly Power Closer",
    enabled: true,
    salesRequired: 10,
    amount: 5000,
    prizeLabel: "",
    maxAwards: 1,
    startDate: null,
    endDate: null,
    headline: "WEEKLY MILESTONE, {agent}!",
    message: "{sales} VALIDATED SALES THIS WEEK!",
    rewardLine: "YOU'VE EARNED {amount} WEEKLY BONUS!",
    sound: "special",
    accent: "#22D3FF",
    popupSeconds: 7,
    leaderboardCount: 10,
    activeSince: null,
  },
  {
    id: "prog_monthly",
    kind: "monthly",
    name: "Monthly Champion",
    enabled: true,
    salesRequired: 40,
    amount: 15000,
    prizeLabel: "",
    maxAwards: 1,
    startDate: null,
    endDate: null,
    headline: "MONTHLY CHAMPION, {agent}!",
    message: "{sales} VALIDATED SALES THIS MONTH!",
    rewardLine: "YOU'VE EARNED {amount} MONTHLY BONUS!",
    sound: "special",
    accent: "#B58CFF",
    popupSeconds: 8,
    leaderboardCount: 10,
    activeSince: null,
  },
];

const MAX_AWARDS_KEPT = 3000;

interface RewardsState {
  programs: BonusProgram[];
  awards: BonusAward[];
  hydrated: boolean;
  updateProgram: (id: string, patch: Partial<BonusProgram>) => void;
  resetPrograms: () => void;
  /** Adds awards whose id is not already recorded. Returns the ones actually added. */
  recordAwards: (awards: BonusAward[]) => BonusAward[];
  setBackendAwards: (awards: BonusAward[]) => void;
  clearAwards: () => void;
}

/** Keeps admin input sane: whole numbers, sensible ranges, ordered dates. */
export function sanitizeProgram(p: BonusProgram): BonusProgram {
  const int = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));
  const startDate = p.startDate;
  const endDate = startDate && p.endDate && p.endDate < startDate ? startDate : p.endDate;
  return {
    ...p,
    name: p.name.slice(0, 40),
    salesRequired: int(p.salesRequired, 1, 500),
    amount: int(p.amount, 0, 10_000_000),
    maxAwards: int(p.maxAwards, 1, 100),
    popupSeconds: int(p.popupSeconds, 3, 30),
    leaderboardCount: int(p.leaderboardCount, 3, 15),
    startDate: startDate || null,
    endDate: endDate || null,
  };
}

export const useRewardsStore = create<RewardsState>()(
  persist(
    (set, get) => ({
      programs: DEFAULT_PROGRAMS,
      awards: [],
      hydrated: false,
      updateProgram: (id, patch) =>
        set({
          programs: get().programs.map((p) => {
            if (p.id !== id) return p;
            const next = { ...p, ...patch };
            // Switching a campaign on starts counting from now.
            if (patch.enabled === true && !p.enabled) next.activeSince = new Date().toISOString();
            return sanitizeProgram(next);
          }),
        }),
      resetPrograms: () => set({ programs: DEFAULT_PROGRAMS.map((p) => ({ ...p, activeSince: new Date().toISOString() })) }),
      recordAwards: (incoming) => {
        const have = new Set(get().awards.map((a) => a.id));
        const added = incoming.filter((a) => !have.has(a.id));
        if (added.length) set({ awards: [...added, ...get().awards].slice(0, MAX_AWARDS_KEPT) });
        return added;
      },
      setBackendAwards: (awards) => set({ awards }),
      clearAwards: () => set({ awards: [] }),
    }),
    {
      name: REWARDS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      ),
      skipHydration: true,
      partialize: (s) => ({ programs: s.programs, awards: s.awards }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<RewardsState>;
        // Keep any new default fields when older saved programs are loaded.
        const now = new Date().toISOString();
        const programs = DEFAULT_PROGRAMS.map((d) => {
          const saved = { ...d, ...(p.programs?.find((x) => x.id === d.id) ?? {}) };
          // First load on this browser: campaigns start counting now.
          return { ...saved, activeSince: saved.activeSince ?? now };
        });
        return { ...current, programs, awards: p.awards ?? [] };
      },
      onRehydrateStorage: () => () => {
        useRewardsStore.setState({ hydrated: true });
      },
    },
  ),
);

export function programFor(programs: BonusProgram[], kind: BonusKind): BonusProgram | undefined {
  return programs.find((p) => p.kind === kind);
}
