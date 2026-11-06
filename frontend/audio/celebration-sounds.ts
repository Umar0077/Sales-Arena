"use client";

import { Howler } from "howler";
import { audioEngine } from "./engine";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import type { SoundCategory } from "@/shared/types";

/**
 * FE Sales Arena celebration sound package: four pre-rendered, original WAV files (public/audio/celebrations,
 * rendered by scripts/render-celebration-sounds.mjs). Presentation only.
 *
 * Uses the existing audio system, not a second one:
 *  - the ONE Web Audio context the audio engine already uses (Howler's), and its master gain, so the Admin sound
 *    switch, master volume and mute apply exactly as before;
 *  - the existing sound categories gate each call; nothing plays before the browser has allowed audio.
 *
 * Reliability:
 *  - Preload: the files are fetched once in the background after the page loads (HTTP cache), decoded once the
 *    audio context exists (first click), and the decoded AudioBuffers stay in memory: playing a sound never fetches
 *    or decodes anything again.
 *  - Scheduling: playback is scheduled on the audio clock (AudioBufferSourceNode.start(when)), so a busy main thread
 *    or a React re-render cannot delay, restart or cut a sound once it has started. Data refreshes never touch it.
 *  - One event, one sound: each sound plays once per event key; repeats return "duplicate".
 *  - Overlap policy: a new sound never hard-cuts the previous one. If the previous one is still in its main part,
 *    the new one is scheduled right after that (at most 0.6 s later) and the previous tail fades out over 0.25 s;
 *    otherwise the new one starts now and the previous one fades out.
 *  - Interruption policy: leaving Teams Arena fades the team sound (120 ms). If the device / browser suspends audio
 *    while a sound plays, that sound is stopped and NOT resumed or replayed later (a late sale sound would mislead).
 *    A sound requested while audio is locked or suspended is skipped, never queued for later. Mute takes effect at
 *    once through the master gain.
 * Spin & Win sounds are not part of this package and are untouched.
 */
export type CelebrationSoundId = "sale" | "sigma" | "panthers" | "bonus";

export const CELEBRATION_SOUNDS: Readonly<Record<CelebrationSoundId, { src: string; label: string; volume: number; core: number }>> = Object.freeze({
  // core = seconds of the main, recognisable part (the rest is a fading tail)
  sale: { src: "/audio/celebrations/sale-validated-chime.wav", label: "Validated sale: Ta-ta-TING!", volume: 0.85, core: 0.55 },
  sigma: { src: "/audio/celebrations/sigma-lion-roar-victory.wav", label: "Team Sigma: lion roar victory", volume: 0.95, core: 1.6 },
  panthers: { src: "/audio/celebrations/panthers-big-cat-growl-victory.wav", label: "Team Panthers: big-cat growl victory", volume: 0.95, core: 1.35 },
  bonus: { src: "/audio/celebrations/cash-bonus-golden-ching.wav", label: "Cash bonus: Pa-pa-pa-CHING!", volume: 0.9, core: 1.1 },
});
const IDS = Object.keys(CELEBRATION_SOUNDS) as CelebrationSoundId[];

export type CelebrationSoundResult = "played" | "muted" | "locked" | "suspended" | "duplicate" | "unavailable";

const LEAD = 0.012; // s: schedule just ahead of "now" so the start is sample-accurate
const MAX_WAIT = 0.6; // s: longest a new sound waits for the previous one's main part
const TAIL_FADE = 0.25;
const LATE_LIMIT_MS = 700; // a sound not decoded within this after its event is skipped (it would be out of sync)

type Voice = { id: CelebrationSoundId; key?: string; src: AudioBufferSourceNode; gain: GainNode; coreEnd: number; end: number };
const bytes = new Map<CelebrationSoundId, Promise<ArrayBuffer | null>>();
const decoded = new Map<CelebrationSoundId, AudioBuffer>();
const decoding = new Map<CelebrationSoundId, Promise<AudioBuffer | null>>();
let voices: Voice[] = [];
let bus: GainNode | null = null;
let watched: AudioContext | null = null;
let everRunning = false;
const played: string[] = [];
const PLAYED_MAX = 300;
const stats = { played: 0, muted: 0, locked: 0, suspended: 0, duplicates: 0, unavailable: 0, stopped: 0, interrupted: 0, late: 0, maxScheduleMs: 0, maxWaitMs: 0 };

const audioCtx = (): AudioContext | null => (Howler.ctx as AudioContext | undefined) ?? null;

function fetchBytes(id: CelebrationSoundId): Promise<ArrayBuffer | null> {
  if (!bytes.has(id))
    bytes.set(
      id,
      fetch(CELEBRATION_SOUNDS[id].src, { cache: "force-cache" })
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null)
        .then((ab) => {
          if (!ab) bytes.delete(id); // retried next time
          return ab;
        }),
    );
  return bytes.get(id)!;
}

/** Decoded and ready (decodes once; resolves false when audio is not available yet). */
export function prepareCelebrationSound(id: CelebrationSoundId): Promise<boolean> {
  if (decoded.has(id)) return Promise.resolve(true);
  const c = audioCtx();
  if (!c) {
    void fetchBytes(id); // at least the bytes are local when audio is allowed
    return Promise.resolve(false);
  }
  watch(c);
  if (!decoding.has(id))
    decoding.set(
      id,
      fetchBytes(id)
        .then((ab) => (ab ? c.decodeAudioData(ab.slice(0)) : null))
        .then((b) => {
          if (b) decoded.set(id, b);
          else decoding.delete(id);
          return b;
        })
        .catch(() => {
          decoding.delete(id);
          return null;
        }),
    );
  return decoding.get(id)!.then(Boolean);
}
export function preloadCelebrationSounds(): void {
  IDS.forEach((id) => void prepareCelebrationSound(id));
}

if (typeof window !== "undefined") {
  // Fetch the bytes in the background once the page is idle; decode when audio is unlocked (first click).
  const idle = (cb: () => void) => ((window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500)))(cb);
  idle(() => IDS.forEach((id) => void fetchBytes(id)));
  const off = audioEngine.subscribe((s) => {
    if (s.unlocked) {
      preloadCelebrationSounds();
      off();
    }
  });
}

/** Suspension policy: a sound cut by the device / browser is stopped for good, never resumed late. */
function watch(c: AudioContext) {
  if (watched === c) return;
  watched = c;
  c.addEventListener("statechange", () => {
    if (c.state === "running") everRunning = true;
    else if (voices.length) {
      for (const v of voices) {
        try {
          v.src.stop();
        } catch {
          /* already stopped */
        }
        stats.interrupted++;
        note(v.id, v.key, "interrupted");
      }
      voices = [];
    }
  });
}

/** The existing switches: master sound on, and this sound's category on. */
export function celebrationSoundAllowed(category: SoundCategory): boolean {
  const s = useSettingsStore.getState();
  return s.soundEnabled !== false && s.soundCategories?.[category] !== false;
}

function note(id: CelebrationSoundId, key: string | undefined, result: string, extra: Record<string, number> = {}) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __celebrationSounds?: Array<Record<string, unknown>>; __celebrationAudio?: unknown };
  (w.__celebrationSounds ??= []).push({ id, key, result, at: Math.round(performance.now()), ...extra });
  if (w.__celebrationSounds.length > 100) w.__celebrationSounds.shift();
  w.__celebrationAudio = { ...stats, decoded: [...decoded.keys()], active: voices.length };
  document.documentElement.dataset.celebrationSound = `${id}:${result}`;
}

function start(c: AudioContext, id: CelebrationSoundId, key: string | undefined, buffer: AudioBuffer, requestedAt: number) {
  if (!bus) {
    bus = c.createGain();
    bus.connect((Howler as unknown as { masterGain: GainNode }).masterGain ?? c.destination); // master volume + mute
  }
  const t0 = c.currentTime + LEAD;
  voices = voices.filter((v) => v.end > c.currentTime);
  const prev = voices.reduce<Voice | null>((a, v) => (!a || v.coreEnd > a.coreEnd ? v : a), null);
  const wait = prev ? prev.coreEnd - t0 : 0;
  const when = wait > 0 && wait <= MAX_WAIT ? prev!.coreEnd : t0;
  for (const v of voices) {
    // fade the previous sound's tail from the moment the new one starts (never a hard cut)
    try {
      v.gain.gain.setValueAtTime(v.gain.gain.value, when);
      v.gain.gain.linearRampToValueAtTime(0, when + TAIL_FADE);
      v.src.stop(when + TAIL_FADE + 0.02);
      v.end = Math.min(v.end, when + TAIL_FADE + 0.02);
    } catch {
      /* already ended */
    }
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const gain = c.createGain();
  gain.gain.value = CELEBRATION_SOUNDS[id].volume;
  src.connect(gain).connect(bus);
  src.start(when);
  const voice: Voice = { id, key, src, gain, coreEnd: when + CELEBRATION_SOUNDS[id].core, end: when + buffer.duration };
  voices.push(voice);
  src.onended = () => {
    voices = voices.filter((v) => v !== voice);
    src.disconnect();
    gain.disconnect();
  };
  stats.played++;
  const scheduleMs = Math.round((performance.now() - requestedAt) + (when - c.currentTime) * 1000);
  stats.maxScheduleMs = Math.max(stats.maxScheduleMs, scheduleMs);
  stats.maxWaitMs = Math.max(stats.maxWaitMs, Math.round(Math.max(0, when - t0) * 1000));
  note(id, key, "played", { scheduleMs, waitMs: Math.round(Math.max(0, when - t0) * 1000) });
}

/**
 * Plays one celebration sound for one event. `key` identifies the event (sale case / popup id / award ids): the
 * same key never plays twice. `allowed` comes from the existing sound switches (see celebrationSoundAllowed).
 */
export function playCelebrationSound(id: CelebrationSoundId, opts: { allowed: boolean; key?: string }): CelebrationSoundResult {
  const k = opts.key ? `${id}:${opts.key}` : null;
  if (k && played.includes(k)) {
    stats.duplicates++;
    note(id, opts.key, "duplicate");
    return "duplicate";
  }
  if (k) {
    played.push(k);
    if (played.length > PLAYED_MAX) played.shift();
  }
  const fail = (r: Exclude<CelebrationSoundResult, "played" | "duplicate">) => {
    stats[r]++;
    note(id, opts.key, r);
    return r;
  };
  if (!opts.allowed) return fail("muted");
  const c = audioCtx();
  if (!c || c.state !== "running") return fail(c && everRunning ? "suspended" : "locked");
  everRunning = true;
  watch(c);
  const requestedAt = performance.now();
  const buffer = decoded.get(id);
  if (buffer) {
    start(c, id, opts.key, buffer, requestedAt);
    return "played";
  }
  // Not decoded yet (the very first sound right after the first click): play as soon as it is, unless that would
  // be noticeably out of sync with its popup.
  void prepareCelebrationSound(id).then((ok) => {
    const lateMs = performance.now() - requestedAt;
    const b = decoded.get(id);
    if (!ok || !b) return void fail("unavailable");
    if (lateMs > LATE_LIMIT_MS || c.state !== "running") {
      stats.late++;
      return void note(id, opts.key, "late", { lateMs: Math.round(lateMs) });
    }
    start(c, id, opts.key, b, requestedAt);
  });
  return "played";
}

/** Fades out what is playing (all, or only the given sounds): a left screen never leaves orphaned audio. */
export function stopCelebrationSound(only?: CelebrationSoundId[]): void {
  const c = audioCtx();
  const hit = voices.filter((v) => !only || only.includes(v.id));
  if (!hit.length) return;
  for (const v of hit) {
    try {
      if (c) {
        v.gain.gain.setValueAtTime(v.gain.gain.value, c.currentTime);
        v.gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.12);
        v.src.stop(c.currentTime + 0.13);
      } else v.src.stop();
    } catch {
      /* already ended */
    }
    stats.stopped++;
    note(v.id, v.key, "stopped");
  }
  voices = voices.filter((v) => !hit.includes(v));
}

/** Test hook. */
export function __resetCelebrationSounds(): void {
  played.length = 0;
  voices = [];
}
