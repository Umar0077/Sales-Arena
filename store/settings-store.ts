"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DisplaySettings, QualityPreset, SoundCategory } from "@/types";

export const SETTINGS_STORAGE_KEY = "sales-arena:settings";

import { DEFAULT_SETTINGS, DEFAULT_SOUND_CATEGORIES } from "@/lib/settings/defaults";
import { readCub } from "@/lib/cub/config";
export { DEFAULT_SETTINGS, DEFAULT_SOUND_CATEGORIES };


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
      // v5: the public arena always opens on Daily Arena (never a stored Spin & Win).
      version: 5,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<DisplaySettings>;
        if (version < 5 && p.defaultArenaMode === "spin") p.defaultArenaMode = "daily";
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
          rewardCategories: { ...DEFAULT_SETTINGS.rewardCategories, ...(p.rewardCategories ?? {}) },
          // The Live Arena permission is never taken from browser storage: only the server can turn it on.
          arenaCub: { ...readCub(p.arenaCub), allowOnLiveArena: false },
        };
      },
      onRehydrateStorage: () => () => {
        useSettingsStore.setState({ hydrated: true });
      },
    },
  ),
);
