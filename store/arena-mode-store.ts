"use client";

import { create } from "zustand";
import { useSettingsStore } from "@/store/settings-store";
import type { ArenaMode, DisplaySettings } from "@/types";

export const ARENA_MODE_ORDER: ArenaMode[] = ["daily", "weekly", "monthly", "spin"];
export const ARENA_MODE_LABEL: Record<ArenaMode, string> = {
  daily: "Daily Arena",
  weekly: "Weekly Arena",
  monthly: "Monthly Arena",
  spin: "Spin & Win",
};

/** The screen this display picked (null = follow the admin default). Not persisted. */
interface ModeState {
  picked: ArenaMode | null;
  setPicked: (m: ArenaMode | null) => void;
}
export const useArenaModeStore = create<ModeState>()((set) => ({ picked: null, setPicked: (picked) => set({ picked }) }));

/** Resolves the screen to show: picked → default → first enabled → Spin & Win. */
export function resolveMode(picked: ArenaMode | null, s: Pick<DisplaySettings, "arenaModes" | "defaultArenaMode">): ArenaMode {
  if (picked && s.arenaModes[picked]) return picked;
  if (s.arenaModes[s.defaultArenaMode]) return s.defaultArenaMode;
  return ARENA_MODE_ORDER.find((m) => s.arenaModes[m]) ?? "spin";
}

export function useArenaMode(): ArenaMode {
  const picked = useArenaModeStore((s) => s.picked);
  const arenaModes = useSettingsStore((s) => s.arenaModes);
  const defaultArenaMode = useSettingsStore((s) => s.defaultArenaMode);
  return resolveMode(picked, { arenaModes, defaultArenaMode });
}
