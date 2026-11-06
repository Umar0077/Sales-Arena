"use client";

import { Howl, Howler } from "howler";
import { TEAM_STINGERS, encodeWav, type TeamStinger } from "./synth";
import type { CelebrationTheme } from "@/shared/teams/celebration";
import { playCelebrationSound, stopCelebrationSound, type CelebrationSoundResult } from "./celebration-sounds";

/**
 * Teams Arena celebration stingers. Built lazily (first use), one at a time, and only:
 *  - once the browser has allowed audio (autoplay policy: never a burst after the first click);
 *  - with the global sound switch on, the "sale" sound category on and the Teams stinger switch on;
 *  - at the configured master volume (Howler's global volume is set by the existing audio engine).
 * Sigma and Panthers play their pre-rendered celebration files (frontend/audio/celebration-sounds.ts); any other
 * team keeps the synthesized neutral stinger below.
 */
const howls: Partial<Record<TeamStinger, Howl>> = {};
let current: { howl: Howl; id: number } | null = null;

export const stingerFor = (theme: CelebrationTheme): TeamStinger => (theme === "lion" ? "royal" : theme === "panther" ? "electric" : "neutral");

function get(kind: TeamStinger): Howl | null {
  if (typeof window === "undefined") return null;
  if (!howls[kind]) {
    try {
      const url = URL.createObjectURL(new Blob([encodeWav(TEAM_STINGERS[kind]())], { type: "audio/wav" }));
      howls[kind] = new Howl({ src: [url], format: ["wav"], preload: true, pool: 1, volume: 0.85 });
    } catch {
      return null;
    }
  }
  return howls[kind] ?? null;
}

export interface StingerPrefs {
  soundEnabled: boolean;
  saleCategory: boolean;
  teamSaleSound: boolean;
}

/** Returns what happened (for diagnostics and tests): "played" or why it stayed silent. `key` = the sale (never replayed). */
export function playTeamStinger(theme: CelebrationTheme, prefs: StingerPrefs, key?: string): CelebrationSoundResult {
  const allowed = prefs.soundEnabled && prefs.saleCategory && prefs.teamSaleSound;
  if (theme === "lion" || theme === "panther") return playCelebrationSound(theme === "lion" ? "sigma" : "panthers", { allowed, key });
  if (!allowed) return "muted";
  if (!Howler.ctx || Howler.ctx.state !== "running") return "locked";
  const howl = get(stingerFor(theme));
  if (!howl) return "unavailable";
  if (current) current.howl.stop(current.id);
  current = { howl, id: howl.play() };
  return "played";
}

export function stopTeamStinger(): void {
  if (current) current.howl.stop(current.id);
  current = null;
  stopCelebrationSound(["sigma", "panthers"]);
}
