"use client";

import { Howl, Howler } from "howler";
import { TEAM_STINGERS, CHRISTMAS_TEAM_STINGERS, encodeWav, type TeamStinger } from "./synth";
import type { CelebrationTheme } from "@/shared/teams/celebration";
import { isChristmasAudioActive } from "@/frontend/theme/arena-theme";
import { audioEngine } from "./engine";

/**
 * Teams Arena celebration stingers. Built lazily (first use), one at a time, and only:
 *  - once the browser has allowed audio (autoplay policy: never a burst after the first click);
 *  - with the global sound switch on, the "sale" sound category on and the Teams stinger switch on;
 *  - at the configured master volume (Howler's global volume is set by the existing audio engine).
 * The Daily / Weekly / Monthly sale and bonus sounds are untouched.
 */
const howls: Partial<Record<TeamStinger, Howl>> = {};
const christmasHowls: Partial<Record<TeamStinger, Howl>> = {};
let current: { howl: Howl; id: number } | null = null;

export const stingerFor = (theme: CelebrationTheme): TeamStinger => (theme === "lion" ? "royal" : theme === "panther" ? "electric" : "neutral");

function get(kind: TeamStinger, christmas = false): Howl | null {
  if (typeof window === "undefined") return null;
  const cache = christmas ? christmasHowls : howls;
  const gens = christmas ? CHRISTMAS_TEAM_STINGERS : TEAM_STINGERS;
  if (!cache[kind]) {
    try {
      const url = URL.createObjectURL(new Blob([encodeWav(gens[kind]())], { type: "audio/wav" }));
      cache[kind] = new Howl({ src: [url], format: ["wav"], preload: true, pool: 1, volume: 0.85 });
    } catch {
      return null;
    }
  }
  return cache[kind] ?? null;
}

export interface StingerPrefs {
  soundEnabled: boolean;
  saleCategory: boolean;
  teamSaleSound: boolean;
  forceChristmas?: boolean;
}

/** Returns what happened (for diagnostics and tests): "played" or why it stayed silent. */
export function playTeamStinger(theme: CelebrationTheme, prefs: StingerPrefs): "played" | "muted" | "locked" | "unavailable" {
  if (!prefs.soundEnabled || !prefs.saleCategory || !prefs.teamSaleSound) return "muted";
  const state = audioEngine.readiness();
  if (state === "locked") return "locked";
  if (state === "unavailable") return "unavailable";
  const useChristmas = prefs.forceChristmas ?? isChristmasAudioActive();
  const howl = get(stingerFor(theme), useChristmas);
  if (!howl) return "unavailable";
  const go = () => {
    if (current) current.howl.stop(current.id);
    current = { howl, id: howl.play() };
  };
  if (state === "running" && Howler.ctx?.state === "running") go();
  // The context was suspended (device / browser): resume it first; play only if that is quick (never late).
  else void audioEngine.whenRunning(600).then((ok) => ok && go());
  return "played";
}

/**
 * Plays the team stinger and resolves once playback completes (or falls back safely within a bounded wait)
 * so voice announcements follow the stinger instead of overlapping it.
 */
export function playTeamStingerWithCompletion(
  theme: CelebrationTheme,
  prefs: StingerPrefs,
): Promise<"played" | "muted" | "locked" | "unavailable"> {
  if (!prefs.soundEnabled || !prefs.saleCategory || !prefs.teamSaleSound) return Promise.resolve("muted");
  const state = audioEngine.readiness();
  if (state === "locked") return Promise.resolve("locked");
  if (state === "unavailable") return Promise.resolve("unavailable");
  const useChristmas = prefs.forceChristmas ?? isChristmasAudioActive();
  const howl = get(stingerFor(theme), useChristmas);
  if (!howl) return Promise.resolve("unavailable");

  const startHowl = () =>
    new Promise<"played">((resolve) => {
      if (current) current.howl.stop(current.id);
      const id = howl.play();
      current = { howl, id };
      const rawDur = typeof howl.duration === "function" ? howl.duration(id) : 0;
      const maxWait = Math.min(3000, Math.max(1200, Number.isFinite(rawDur) && rawDur > 0 ? Math.ceil(rawDur * 1000) + 120 : 2500));
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (typeof howl.off === "function") {
          howl.off("end", done, id);
          howl.off("stop", done, id);
          howl.off("playerror", done, id);
        }
        resolve("played");
      };
      const timer = setTimeout(done, maxWait);
      if (typeof howl.once === "function") {
        howl.once("end", done, id);
        howl.once("stop", done, id);
        howl.once("playerror", done, id);
      }
    });

  if (state === "running" && Howler.ctx?.state === "running") {
    return startHowl();
  }
  return audioEngine.whenRunning(600).then((ok) => (ok ? startHowl() : "locked"));
}

export function stopTeamStinger(): void {
  if (current) current.howl.stop(current.id);
  current = null;
}
