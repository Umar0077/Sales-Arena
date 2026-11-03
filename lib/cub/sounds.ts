"use client";

import { Howl, Howler } from "howler";
import { CUB_SOUNDS, encodeWav, type CubSound } from "@/lib/audio/synth";

/**
 * Arena Cub sounds: one at a time (a new one stops the previous), never before the browser has allowed
 * audio (no queued burst after the first click), and only when the caller says sound is allowed
 * (global sound on, cub sounds on, not quiet hours).
 */
const howls: Partial<Record<CubSound, Howl>> = {};
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

export function playCubSound(kind: CubSound, volume: number): void {
  if (!Howler.ctx || Howler.ctx.state !== "running") return; // autoplay not unlocked yet: stay silent
  const howl = get(kind);
  if (!howl) return;
  if (current) current.howl.stop(current.id);
  const id = howl.play();
  howl.volume(Math.max(0, Math.min(1, volume)), id);
  current = { howl, id };
}

export function stopCubSound(): void {
  if (current) current.howl.stop(current.id);
  current = null;
}
