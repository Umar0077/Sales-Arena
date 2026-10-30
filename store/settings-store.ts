"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DisplaySettings, QualityPreset, SoundCategory } from "@/types";

export const SETTINGS_STORAGE_KEY = "sales-arena:settings";

export const DEFAULT_SOUND_CATEGORIES: Record<SoundCategory, boolean> = {
  sale: true,
  target: true,
  spinUnlocked: true,
  wheelActivate: true,
  wheelMove: true,
  tick: true,
  reveal: true,
  ui: true,
  special: true,
};

export const DEFAULT_SETTINGS: DisplaySettings = {
  intensity: "standard",
  particles: true,
  soundEnabled: true,
  volume: 0.7,
  soundCategories: DEFAULT_SOUND_CATEGORIES,
  celebrationDuration: 5,
  quality: "auto",
  motion: "system",
  accent: "violet",
  diagnostics: false,
  tvMode: false,
  seededSpins: false,
  spinSeed: 2026,

  spinnerTheme: "neon",
  segmentColorMode: "theme",
  glowIntensity: 1,
  spinnerLights: true,
  lightSpeed: 1,
  spinDurationScale: 1,

  arenaEnabled: true,
  arenaOfflineMessage: "We'll be back on air shortly.",
  brandName: "FE SALES ARENA",
  brandTagline: "Live Sales Broadcast",
  customLogo: null,
  backgroundEffects: "full",
  showKpis: true,
  showHero: true,
  showActivity: true,
  autoSimulate: false,
  autoSimulateEverySec: 8,
  showDemoSpinButton: true,

  leaderboardVisible: true,
  leaderboardCount: 10,
  leaderboardCriteria: "sales",
  leaderboardPeriod: "daily",
  leaderboardTeamId: null,
  leaderboardCampaignId: null,
  leaderboardAnimations: true,
  leaderboardSize: "comfortable",
  topPerformerStyle: "podium",

  saleCelebrationStyle: "toast",
  announceMilestones: true,
  announceTeamTargets: true,
  spinFeatureEnabled: true,
  spinFlowEnabled: true,
  spinPopupTimeoutSec: 30,
  achievementHeadline: "CONGRATULATIONS, {agent}!",
  achievementMessage: "You've completed {sales} approved sales!",
  achievementReward: "You've earned {spins}!",
  revealHeadline: "CONGRATULATIONS, {agent}!",
  revealMessage: "YOU WON {prize}!",
  revealStyle: "cinematic",

  arenaModes: { daily: true, weekly: true, monthly: true, spin: true },
  defaultArenaMode: "spin",
  showModeSelector: true,
  // Opt-in: by default only the default screen's bonus program awards.
  programsConcurrent: false,
  businessTimezone: "America/New_York",
  weekStartDay: 1,
  weeklyFloorTarget: 3500,
  monthlyFloorTarget: 16000,
  currencyLabel: "Rs.",
};

/** Fills a message template such as "CONGRATULATIONS, {agent}!". */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
}

interface SettingsStore extends DisplaySettings {
  hydrated: boolean;
  /** Quality detected for "auto" (device heuristics + runtime monitor). Not persisted. */
  autoQuality: QualityPreset;
  update: (patch: Partial<DisplaySettings>) => void;
  setCategory: (category: SoundCategory, enabled: boolean) => void;
  setAutoQuality: (q: QualityPreset) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      hydrated: false,
      autoQuality: "high",
      update: (patch) => set(patch),
      setCategory: (category, enabled) => set({ soundCategories: { ...get().soundCategories, [category]: enabled } }),
      setAutoQuality: (q) => set({ autoQuality: q }),
      reset: () => set({ ...DEFAULT_SETTINGS, soundCategories: { ...DEFAULT_SOUND_CATEGORIES } }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      // v2: leaderboard became "Top 10 closers" (old default was 8).
      // v3: realistic weekly/monthly floor targets (old defaults 2500 / 10000).
      // v4: campaign rename to "FE SALES ARENA" (keeps any custom brand name).
      version: 4,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<DisplaySettings>;
        if (version < 4 && (!p.brandName || p.brandName === "SALES ARENA")) p.brandName = "FE SALES ARENA";
        if (version < 2 && (p.leaderboardCount === undefined || p.leaderboardCount === 8)) p.leaderboardCount = 10;
        if (version < 3) {
          if (p.weeklyFloorTarget === 2500) p.weeklyFloorTarget = 3500;
          if (p.monthlyFloorTarget === 10000) p.monthlyFloorTarget = 16000;
        }
        return p as unknown as SettingsStore;
      },
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? localStorage
          : {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            }
      ),
      skipHydration: true,
      partialize: (s) => {
        const { hydrated: _h, autoQuality: _a, update: _u, setCategory: _c, setAutoQuality: _q, reset: _r, ...rest } = s;
        return rest;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DisplaySettings>;
        return {
          ...current,
          ...p,
          soundCategories: { ...DEFAULT_SOUND_CATEGORIES, ...(p.soundCategories ?? {}) },
          arenaModes: { ...DEFAULT_SETTINGS.arenaModes, ...(p.arenaModes ?? {}) },
        };
      },
      onRehydrateStorage: () => () => {
        useSettingsStore.setState({ hydrated: true });
      },
    },
  ),
);
