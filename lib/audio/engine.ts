"use client";

import { Howl, Howler } from "howler";
import type { SoundCategory } from "@/types";
import { GENERATORS, encodeWav } from "./synth";

/** Minimum time between two plays of the same category (prevents sound chaos). */
const MIN_INTERVAL: Record<SoundCategory, number> = {
  sale: 250,
  target: 600,
  spinUnlocked: 500,
  wheelActivate: 600,
  wheelMove: 0,
  tick: 38,
  reveal: 1200,
  ui: 60,
  special: 900,
};

const BASE_VOLUME: Record<SoundCategory, number> = {
  sale: 0.75,
  target: 0.85,
  spinUnlocked: 0.7,
  wheelActivate: 0.8,
  wheelMove: 0.35,
  tick: 0.45,
  reveal: 0.9,
  ui: 0.35,
  special: 0.9,
};

const LOUD: SoundCategory[] = ["reveal", "special", "target"];

export interface AudioPrefs {
  enabled: boolean;
  volume: number;
  categories: Record<SoundCategory, boolean>;
}

type Listener = (state: { unlocked: boolean; ready: boolean }) => void;

class AudioEngine {
  private howls: Partial<Record<SoundCategory, Howl>> = {};
  private urls: string[] = [];
  private lastPlayed: Partial<Record<SoundCategory, number>> = {};
  private loopId: number | null = null;
  private prefs: AudioPrefs = { enabled: true, volume: 0.7, categories: {} as Record<SoundCategory, boolean> };
  private listeners = new Set<Listener>();
  private duckUntil = 0;
  ready = false;

  /** Generate buffers lazily on the first user interaction (autoplay policy). */
  init(): void {
    if (this.ready || typeof window === "undefined") return;
    try {
      (Object.keys(GENERATORS) as SoundCategory[]).forEach((cat) => {
        const wav = encodeWav(GENERATORS[cat]());
        const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
        this.urls.push(url);
        this.howls[cat] = new Howl({
          src: [url],
          format: ["wav"],
          loop: cat === "wheelMove",
          volume: BASE_VOLUME[cat],
          pool: cat === "tick" ? 8 : 3,
          preload: true,
        });
      });
      this.ready = true;
      this.applyPrefs();
      this.emit();
    } catch (err) {
      console.warn("[audio] initialisation failed — continuing silently", err);
    }
  }

  unlock(): void {
    this.init();
    const ctx = Howler.ctx;
    if (ctx && ctx.state !== "running") {
      ctx.resume().then(() => this.emit()).catch(() => this.emit());
    } else {
      this.emit();
    }
  }

  isUnlocked(): boolean {
    return this.ready && !!Howler.ctx && Howler.ctx.state === "running";
  }

  setPrefs(prefs: AudioPrefs): void {
    this.prefs = prefs;
    this.applyPrefs();
  }

  private applyPrefs(): void {
    if (!this.ready) return;
    Howler.volume(Math.max(0, Math.min(1, this.prefs.volume)));
    Howler.mute(!this.prefs.enabled);
    if ((!this.prefs.enabled || !this.prefs.categories.wheelMove) && this.loopId !== null) this.stopLoop();
  }

  private allowed(cat: SoundCategory): boolean {
    return this.ready && this.prefs.enabled && this.prefs.categories[cat] !== false;
  }

  play(cat: SoundCategory, opts: { rate?: number; volume?: number } = {}): void {
    if (!this.allowed(cat)) return;
    const now = performance.now();
    if (now - (this.lastPlayed[cat] ?? 0) < MIN_INTERVAL[cat]) return;
    // Avoid stacking minor sounds over big cinematic cues.
    if (!LOUD.includes(cat) && cat !== "tick" && cat !== "ui" && now < this.duckUntil) return;
    this.lastPlayed[cat] = now;
    const howl = this.howls[cat];
    if (!howl) return;
    const id = howl.play();
    howl.volume(BASE_VOLUME[cat] * (opts.volume ?? 1), id);
    if (opts.rate) howl.rate(opts.rate, id);
    if (LOUD.includes(cat)) this.duckUntil = now + 900;
  }

  startLoop(): void {
    if (!this.allowed("wheelMove") || this.loopId !== null) return;
    const howl = this.howls.wheelMove;
    if (!howl) return;
    this.loopId = howl.play();
    howl.volume(0, this.loopId);
  }

  /** Called at a throttled rate from the spinner with normalised speed 0..1. */
  setLoopIntensity(speed01: number): void {
    const howl = this.howls.wheelMove;
    if (!howl || this.loopId === null) return;
    howl.volume(BASE_VOLUME.wheelMove * Math.min(1, speed01 * 1.2), this.loopId);
    howl.rate(0.6 + speed01 * 0.9, this.loopId);
  }

  stopLoop(): void {
    const howl = this.howls.wheelMove;
    if (howl && this.loopId !== null) {
      const id = this.loopId;
      howl.fade(howl.volume(id) as number, 0, 250, id);
      setTimeout(() => howl.stop(id), 260);
    }
    this.loopId = null;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = { unlocked: this.isUnlocked(), ready: this.ready };
    this.listeners.forEach((l) => l(s));
  }
}

export const audioEngine = new AudioEngine();
