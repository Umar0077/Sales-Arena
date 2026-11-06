"use client";

import { create } from "zustand";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import type { ArenaMode, DisplaySettings } from "@/shared/types";

export const ARENA_MODE_ORDER: ArenaMode[] = ["daily", "weekly", "monthly", "teams", "spin"];
export const ARENA_MODE_LABEL: Record<ArenaMode, string> = {
  daily: "Daily Arena",
  weekly: "Weekly Arena",
  monthly: "Monthly Arena",
  teams: "Teams Arena",
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
  if (picked && s.arenaModes?.[picked]) return picked;
  // Opening screen: the admin default, but never Spin & Win (that is reached via SPIN NOW or the tab).
  if (s.defaultArenaMode !== "spin" && s.arenaModes[s.defaultArenaMode]) return s.defaultArenaMode;
  if (s.arenaModes.daily) return "daily";
  return ARENA_MODE_ORDER.find((m) => m !== "spin" && s.arenaModes[m]) ?? ARENA_MODE_ORDER.find((m) => s.arenaModes[m]) ?? "daily";
}

export function useArenaMode(): ArenaMode {
  const picked = useArenaModeStore((s) => s.picked);
  const arenaModes = useSettingsStore((s) => s.arenaModes);
  const defaultArenaMode = useSettingsStore((s) => s.defaultArenaMode);
  return resolveMode(picked, { arenaModes, defaultArenaMode });
}
