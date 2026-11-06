"use client";

import { Howl, Howler } from "howler";
import type { SoundCategory } from "@/shared/types";
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

/** Can a sound play now? running; resumable (the page already had a user gesture, so resume() is allowed); locked. */
export type AudioReadiness = "running" | "resumable" | "locked" | "unavailable";

// Root cause of the silent Live Arena: Howler suspends the AudioContext after 30 s without a Howler sound. On a TV
// that sits idle between sales, the team stingers and the trumpet (which require a running context) then stayed
// silent. The Arena keeps its context running instead (negligible cost; Admin previews resumed it on every click).
if (typeof window !== "undefined") Howler.autoSuspend = false;

class AudioEngine {
  private howls: Partial<Record<SoundCategory, Howl>> = {};
  private urls: string[] = [];
  private lastPlayed: Partial<Record<SoundCategory, number>> = {};
  private loopId: number | null = null;
  private prefs: AudioPrefs = { enabled: true, volume: 0.7, categories: {} as Record<SoundCategory, boolean> };
  private listeners = new Set<Listener>();
  private duckUntil = 0;
  private gestured = false;
  private watchedCtx: AudioContext | null = null;
  ready = false;
  /** Diagnostics (Admin → Settings → Run Sound Diagnostics). */
  readonly diag = { initError: null as string | null, resumes: 0, resumeFailures: 0, plays: 0, skippedLocked: 0, skippedMuted: 0, loadErrors: 0, lastError: null as string | null };

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
          onloaderror: (_id, err) => {
            this.diag.loadErrors++;
            this.diag.lastError = `${cat}: ${String(err)}`;
          },
        });
      });
      this.ready = true;
      this.applyPrefs();
      this.watchCtx();
      this.emit();
    } catch (err) {
      this.diag.initError = String(err);
      console.warn("[audio] initialisation failed — continuing silently", err);
    }
  }

  private watchCtx(): void {
    const ctx = Howler.ctx as AudioContext | undefined;
    if (!ctx || this.watchedCtx === ctx) return;
    this.watchedCtx = ctx;
    ctx.addEventListener("statechange", () => this.emit());
  }

  /** Called from a user gesture (click / key): creates the sounds and lets the browser start audio. */
  unlock(): void {
    this.gestured = true;
    this.init();
    this.watchCtx();
    const ctx = Howler.ctx;
    if (ctx && ctx.state !== "running") {
      ctx.resume().then(() => this.emit()).catch(() => this.emit());
    } else {
      this.emit();
    }
  }

  /** Page load: prepare the sounds and start audio if this browser allows it without a click (kiosk / autoplay policy). */
  autoStart(): void {
    this.init();
    this.watchCtx();
    const ctx = Howler.ctx;
    if (ctx && ctx.state !== "running") ctx.resume().then(() => this.emit()).catch(() => this.emit());
  }

  /** The page has had a user gesture (sticky activation): the browser allows resume() without a new click. */
  private activated(): boolean {
    const ua = (navigator as unknown as { userActivation?: { hasBeenActive?: boolean } }).userActivation;
    return this.gestured || ua?.hasBeenActive === true;
  }

  readiness(): AudioReadiness {
    if (typeof window === "undefined") return "locked";
    const ctx = Howler.ctx as AudioContext | undefined;
    if (!ctx) return "locked"; // no audio context yet (created on load / first click)
    if (ctx.state === "running") return "running";
    if (ctx.state === "closed") return "unavailable";
    return this.activated() ? "resumable" : "locked";
  }

  /** Resumes a suspended context (only works once the browser allows audio). Resolves true when running. */
  whenRunning(maxMs = 600): Promise<boolean> {
    this.init();
    const ctx = Howler.ctx as AudioContext | undefined;
    if (!ctx) return Promise.resolve(false);
    if (ctx.state === "running") return Promise.resolve(true);
    this.diag.resumes++;
    return Promise.race([
      ctx.resume().then(() => true, () => false),
      new Promise<boolean>((r) => setTimeout(() => r(false), maxMs)),
    ]).then((ok) => {
      const running = ok && ctx.state === "running";
      if (!running) this.diag.resumeFailures++;
      this.emit();
      return running;
    });
  }

  prefsSnapshot(): AudioPrefs {
    return this.prefs;
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
    if (!this.ready && this.activated()) this.init();
    if (!this.allowed(cat)) {
      if (this.ready) this.diag.skippedMuted++;
      return;
    }
    const state = this.readiness();
    // Never queue a sound in a locked context: it would burst out late, all at once, at the first click.
    if (state === "locked" || state === "unavailable") {
      this.diag.skippedLocked++;
      return;
    }
    const now = performance.now();
    if (now - (this.lastPlayed[cat] ?? 0) < MIN_INTERVAL[cat]) return;
    // Avoid stacking minor sounds over big cinematic cues.
    if (!LOUD.includes(cat) && cat !== "tick" && cat !== "ui" && now < this.duckUntil) return;
    this.lastPlayed[cat] = now;
    const howl = this.howls[cat];
    if (!howl) return;
    if (state === "resumable") void this.whenRunning(); // Howler also resumes on play; this records it
    const id = howl.play();
    howl.volume(BASE_VOLUME[cat] * (opts.volume ?? 1), id);
    if (opts.rate) howl.rate(opts.rate, id);
    if (LOUD.includes(cat)) this.duckUntil = now + 900;
    this.diag.plays++;
  }

  /** Loaded state of the engine's own sounds (diagnostics). */
  loadedCategories(): { loaded: SoundCategory[]; failed: SoundCategory[] } {
    const loaded: SoundCategory[] = [];
    const failed: SoundCategory[] = [];
    (Object.keys(this.howls) as SoundCategory[]).forEach((c) => {
      const st = this.howls[c]?.state();
      if (st === "loaded") loaded.push(c);
      else if (st === "unloaded") failed.push(c);
    });
    return { loaded, failed };
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
