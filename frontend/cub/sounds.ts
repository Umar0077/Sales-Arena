"use client";

import { Howl, Howler } from "howler";
import { CUB_SOUNDS, CHRISTMAS_CUB_SOUNDS, encodeWav, type CubSound, type ChristmasCubExtraSound } from "@/frontend/audio/synth";
import { isChristmasAudioActive } from "@/frontend/theme/arena-theme";
import { audioEngine } from "@/frontend/audio/engine";

/**
 * Arena Cub sounds: one at a time (a new one stops the previous), never before the browser has allowed
 * audio (no queued burst after the first click), and only when the caller says sound is allowed
 * (global sound on, cub sounds on, not quiet hours).
 */
const howls: Partial<Record<CubSound, Howl>> = {};
const christmasHowls: Partial<Record<CubSound | ChristmasCubExtraSound, Howl>> = {};
let current: { howl: Howl; id: number } | null = null;

function get(kind: CubSound): Howl | null {
  if (typeof window === "undefined") return null;
  if (!howls[kind]) {
    try {
      const url = URL.createObjectURL(new Blob([encodeWav(CUB_SOUNDS[kind]())], { type: "audio/wav" }));
      howls[kind] = new Howl({ src: [url], format: ["wav"], preload: true, pool: 1 });
    } catch {
      return null;
    }
  }
  return howls[kind] ?? null;
}

function getChristmas(kind: CubSound | ChristmasCubExtraSound): Howl | null {
  if (typeof window === "undefined") return null;
  if (!christmasHowls[kind]) {
    try {
      const url = URL.createObjectURL(new Blob([encodeWav(CHRISTMAS_CUB_SOUNDS[kind]())], { type: "audio/wav" }));
      christmasHowls[kind] = new Howl({ src: [url], format: ["wav"], preload: true, pool: 1 });
    } catch {
      return null;
    }
  }
  return christmasHowls[kind] ?? null;
}

export function playCubSound(kind: CubSound, volume: number): void {
  if (!Howler.ctx || Howler.ctx.state !== "running") return; // autoplay not unlocked yet: stay silent
  const howl = isChristmasAudioActive() ? getChristmas(kind) : get(kind);
  if (!howl) return;
  if (current) current.howl.stop(current.id);
  const id = howl.play();
  howl.volume(Math.max(0, Math.min(1, volume)), id);
  current = { howl, id };
}

/** Local Admin preview for Santa Arena Cub or Normal Arena Cub sounds. */
export function playCubSoundPreview(kind: CubSound | ChristmasCubExtraSound, christmas = true, volume = 0.75): void {
  audioEngine.unlock();
  const go = () => {
    const howl = christmas
      ? getChristmas(kind)
      : get((kind in CUB_SOUNDS ? kind : "bonus") as CubSound);
    if (!howl) return;
    if (current) current.howl.stop(current.id);
    const id = howl.play();
    howl.volume(Math.max(0, Math.min(1, volume)), id);
    current = { howl, id };
  };
  if (Howler.ctx?.state === "running") go();
  else setTimeout(go, 60);
}

export function stopCubSound(): void {
  if (current) current.howl.stop(current.id);
  current = null;
}
