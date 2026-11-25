"use client";

import React, { createContext, useContext, useMemo } from "react";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import type { ArenaThemeId, SnowfallIntensity, VisualIntensity } from "@/shared/types";

export interface ArenaThemeMeta {
  id: ArenaThemeId;
  name: string;
  label: string;
  subtitle: string;
  badge: string;
  description: string;
  palette: readonly [string, string, string, string, string];
  highlights: readonly string[];
}

export const ARENA_THEMES: Readonly<Record<ArenaThemeId, ArenaThemeMeta>> = Object.freeze({
  normal: {
    id: "normal",
    name: "Normal Arena",
    label: "Normal Arena",
    subtitle: "Default Broadcast",
    badge: "Default Broadcast",
    description: "Original Sales Arena appearance and sound experience.",
    palette: ["#7568FF", "#27D5FF", "#36E0B5", "#FFC857", "#070B16"],
    highlights: ["Original Broadcast Colors", "Normal Arena Cub", "Standard Sale & Bonus Audio"],
  },
  christmas: {
    id: "christmas",
    name: "Christmas Edition",
    label: "Christmas Edition",
    subtitle: "Seasonal Broadcast",
    badge: "Seasonal Broadcast",
    description: "Festive red, green and gold Arena with snowfall, Santa Cub and holiday celebration sounds.",
    palette: ["#A61F32", "#761B29", "#173D32", "#D8AF58", "#FFF8EE"],
    highlights: ["Red, Evergreen & Gold Theme", "Santa Arena Cub Costume", "Snowfall & Sleigh-Bell Audio"],
  },
});

/**
 * Safely normalizes any stored or incoming theme identifier.
 * Unknown, null, or invalid values always fall back to "normal".
 */
export function normalizeArenaTheme(value: unknown): ArenaThemeId {
  return value === "christmas" ? "christmas" : "normal";
}

export function normalizeSnowfallIntensity(value: unknown): SnowfallIntensity {
  if (value === "off" || value === "light" || value === "medium") return value;
  return "light";
}

export function normalizeChristmasEffects(value: unknown): VisualIntensity {
  if (value === "calm" || value === "standard" || value === "epic") return value;
  return "standard";
}

export interface ArenaThemeState {
  theme: ArenaThemeId;
  isChristmas: boolean;
  snowfall: SnowfallIntensity;
  christmasSounds: boolean;
  christmasSantaCub: boolean;
  effectsIntensity: VisualIntensity;
  preview: boolean;
}

const ArenaThemeContext = createContext<ArenaThemeState | null>(null);

/**
 * Reads the active Arena theme (from a local preview scope if inside Admin preview,
 * or from the global PostgreSQL-backed settings store on live Arena displays).
 */
export function useArenaTheme(): ArenaThemeState {
  const scoped = useContext(ArenaThemeContext);
  const storeTheme = useSettingsStore((s) => s.arenaTheme);
  const storeSnowfall = useSettingsStore((s) => s.christmasSnowfall);
  const storeSounds = useSettingsStore((s) => s.christmasSounds);
  const storeSantaCub = useSettingsStore((s) => s.christmasSantaCub);
  const storeEffects = useSettingsStore((s) => s.christmasEffectsIntensity);

  return useMemo(() => {
    if (scoped) return scoped;
    const theme = normalizeArenaTheme(storeTheme);
    return {
      theme,
      isChristmas: theme === "christmas",
      snowfall: normalizeSnowfallIntensity(storeSnowfall),
      christmasSounds: storeSounds !== false,
      christmasSantaCub: storeSantaCub !== false,
      effectsIntensity: normalizeChristmasEffects(storeEffects),
      preview: false,
    };
  }, [scoped, storeTheme, storeSnowfall, storeSounds, storeSantaCub, storeEffects]);
}

/**
 * Non-hook check for the audio engine and sound helpers.
 */
export function isChristmasAudioActive(themeOverride?: ArenaThemeId): boolean {
  const s = useSettingsStore.getState();
  const theme = themeOverride ? normalizeArenaTheme(themeOverride) : normalizeArenaTheme(s.arenaTheme);
  return theme === "christmas" && s.christmasSounds !== false;
}

/**
 * Scoped theme container used by the public Arena root and by the isolated Admin 16:9 TV Preview.
 * Applies `data-arena-theme` only to its own DOM subtree so Admin pages are never restyled.
 */
export function ArenaThemeScope({
  theme: themeOverride,
  snowfall: snowfallOverride,
  christmasSounds: soundsOverride,
  christmasSantaCub: santaOverride,
  effectsIntensity: effectsOverride,
  preview = false,
  className,
  children,
}: {
  theme?: ArenaThemeId;
  snowfall?: SnowfallIntensity;
  christmasSounds?: boolean;
  christmasSantaCub?: boolean;
  effectsIntensity?: VisualIntensity;
  preview?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const storeTheme = useSettingsStore((s) => s.arenaTheme);
  const storeSnowfall = useSettingsStore((s) => s.christmasSnowfall);
  const storeSounds = useSettingsStore((s) => s.christmasSounds);
  const storeSantaCub = useSettingsStore((s) => s.christmasSantaCub);
  const storeEffects = useSettingsStore((s) => s.christmasEffectsIntensity);

  const state = useMemo<ArenaThemeState>(() => {
    const theme = normalizeArenaTheme(themeOverride ?? storeTheme);
    return {
      theme,
      isChristmas: theme === "christmas",
      snowfall: normalizeSnowfallIntensity(snowfallOverride ?? storeSnowfall),
      christmasSounds: (soundsOverride ?? storeSounds) !== false,
      christmasSantaCub: (santaOverride ?? storeSantaCub) !== false,
      effectsIntensity: normalizeChristmasEffects(effectsOverride ?? storeEffects),
      preview,
    };
  }, [
    themeOverride,
    storeTheme,
    snowfallOverride,
    storeSnowfall,
    soundsOverride,
    storeSounds,
    santaOverride,
    storeSantaCub,
    effectsOverride,
    storeEffects,
    preview,
  ]);

  return (
    <ArenaThemeContext.Provider value={state}>
      <div
        data-arena-theme={state.theme}
        data-christmas-effects={state.isChristmas ? state.effectsIntensity : undefined}
        data-christmas-snowfall={state.isChristmas ? state.snowfall : undefined}
        className={className}
      >
        {children}
      </div>
    </ArenaThemeContext.Provider>
  );
}
