/**
 * Original synthesized sound effects (no external/proprietary assets).
 * Each generator renders a mono Float32Array that is encoded as WAV and
 * played through Howler.js.
 */
import type { SoundCategory } from "@/shared/types";

export const SAMPLE_RATE = 44100;

type Wave = "sine" | "triangle" | "brass" | "bell";

interface ToneOptions {
  wave?: Wave;
  gain?: number;
  attack?: number;
  release?: number;
  glideTo?: number;
  vibrato?: number;
}

class Mixer {
  readonly data: Float32Array;
  constructor(seconds: number) {
    this.data = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
  }

  tone(freq: number, start: number, dur: number, o: ToneOptions = {}): this {
    const { wave = "sine", gain = 0.3, attack = 0.005, release = dur * 0.8, glideTo, vibrato = 0 } = o;
    const s0 = Math.floor(start * SAMPLE_RATE);
    const n = Math.floor(dur * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < n && s0 + i < this.data.length; i++) {
      const t = i / SAMPLE_RATE;
      const f = (glideTo ? freq + (glideTo - freq) * Math.min(1, t / dur) : freq) * (1 + vibrato * Math.sin(2 * Math.PI * 5.5 * t));
      phase += (2 * Math.PI * f) / SAMPLE_RATE;
      let v: number;
      switch (wave) {
        case "triangle":
          v = (2 / Math.PI) * Math.asin(Math.sin(phase));
          break;
        case "brass":
          v = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.28 * Math.sin(3 * phase) + 0.14 * Math.sin(4 * phase) + 0.07 * Math.sin(5 * phase);
          v *= 0.5;
          break;
        case "bell":
          v = Math.sin(phase) + 0.42 * Math.sin(2.76 * phase) * Math.exp(-t * 6) + 0.25 * Math.sin(5.4 * phase) * Math.exp(-t * 10);
          v *= 0.6;
          break;
        default:
          v = Math.sin(phase);
      }
      const env = Math.min(1, t / attack) * (t > dur - release ? Math.max(0, (dur - t) / release) : 1);
      this.data[s0 + i] += v * env * gain;
    }
    return this;
  }

  /** Exponentially decaying tone (plucks, bells, hits). */
  pluck(freq: number, start: number, dur: number, gain = 0.3, wave: Wave = "sine", decay = 5): this {
    const s0 = Math.floor(start * SAMPLE_RATE);
    const n = Math.floor(dur * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < n && s0 + i < this.data.length; i++) {
      const t = i / SAMPLE_RATE;
      phase += (2 * Math.PI * freq) / SAMPLE_RATE;
      let v = Math.sin(phase);
      if (wave === "bell") v = 0.7 * v + 0.3 * Math.sin(2.76 * phase) * Math.exp(-t * 8);
      if (wave === "triangle") v = (2 / Math.PI) * Math.asin(Math.sin(phase));
      const env = Math.min(1, t / 0.003) * Math.exp(-t * decay);
      this.data[s0 + i] += v * env * gain;
    }
    return this;
  }

  /** Low drum-like hit with pitch drop. */
  boom(start: number, dur: number, from = 120, to = 45, gain = 0.5): this {
    const s0 = Math.floor(start * SAMPLE_RATE);
    const n = Math.floor(dur * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < n && s0 + i < this.data.length; i++) {
      const t = i / SAMPLE_RATE;
      const f = to + (from - to) * Math.exp(-t * 18);
      phase += (2 * Math.PI * f) / SAMPLE_RATE;
      this.data[s0 + i] += Math.sin(phase) * Math.exp(-t * (4 / dur)) * gain;
    }
    return this;
  }

  /** Filtered noise with a cutoff sweep (one-pole low-pass; optional high-pass). */
  noise(start: number, dur: number, o: { gain?: number; from?: number; to?: number; highpass?: boolean; attack?: number; seed?: number } = {}): this {
    const { gain = 0.2, from = 800, to = 800, highpass = false, attack = 0.01 } = o;
    let seed = o.seed ?? 1234567;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296 - 0.5;
    };
    const s0 = Math.floor(start * SAMPLE_RATE);
    const n = Math.floor(dur * SAMPLE_RATE);
    let lp = 0;
    for (let i = 0; i < n && s0 + i < this.data.length; i++) {
      const t = i / SAMPLE_RATE;
      const cutoff = from + (to - from) * (t / dur);
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
      const x = rand() * 2;
      lp += a * (x - lp);
      const v = highpass ? x - lp : lp;
      const env = Math.min(1, t / attack) * Math.sin(Math.PI * Math.min(1, t / dur)) ** 0.6;
      this.data[s0 + i] += v * env * gain;
    }
    return this;
  }

  /** Simple multi-tap feedback echo for a sense of space. */
  space(mix = 0.18, times = [0.047, 0.071, 0.113], feedback = 0.42): this {
    const src = this.data.slice();
    for (const time of times) {
      const d = Math.floor(time * SAMPLE_RATE);
      for (let i = d; i < this.data.length; i++) {
        src[i] += src[i - d] * feedback * 0.5;
      }
    }
    for (let i = 0; i < this.data.length; i++) this.data[i] = this.data[i] * (1 - mix) + src[i] * mix;
    return this;
  }

  /** Soft limiter + short fade-out to avoid clicks. */
  finish(peak = 0.85): Float32Array {
    let max = 0;
    for (let i = 0; i < this.data.length; i++) max = Math.max(max, Math.abs(this.data[i]));
    const norm = max > peak ? peak / max : 1;
    const fade = Math.floor(0.01 * SAMPLE_RATE);
    for (let i = 0; i < this.data.length; i++) {
      let v = Math.tanh(this.data[i] * norm * 1.1);
      if (i > this.data.length - fade) v *= (this.data.length - i) / fade;
      this.data[i] = v;
    }
    return this.data;
  }
}

const NOTE = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12);

export const GENERATORS: Record<SoundCategory, () => Float32Array> = {
  sale: () =>
    new Mixer(1.1)
      .pluck(NOTE(19), 0, 1.0, 0.32, "bell", 5) // E6
      .pluck(NOTE(26), 0.085, 1.0, 0.3, "bell", 4.5) // B6
      .boom(0, 0.25, 160, 70, 0.22)
      .space(0.22)
      .finish(0.7),
  target: () => {
    const m = new Mixer(2.0);
    [3, 7, 10, 15].forEach((n, i) => m.pluck(NOTE(n), i * 0.085, 1.4, 0.24, "triangle", 3));
    [3, 7, 10, 15, 19].forEach((n) => m.tone(NOTE(n), 0.36, 1.5, { wave: "brass", gain: 0.06, attack: 0.08, release: 1.1 }));
    m.boom(0.34, 0.6, 110, 42, 0.35).noise(0.3, 1.4, { gain: 0.05, from: 6000, to: 2000, highpass: true });
    return m.space(0.25).finish(0.8);
  },
  spinUnlocked: () => {
    const m = new Mixer(1.4);
    [0, 2, 4, 7, 9, 12, 14, 16, 19].forEach((n, i) => m.pluck(NOTE(n + 12), i * 0.045, 0.6, 0.16, "bell", 6));
    m.noise(0, 1.1, { gain: 0.06, from: 3000, to: 9000, highpass: true });
    return m.space(0.3).finish(0.7);
  },
  wheelActivate: () =>
    new Mixer(1.1)
      .noise(0, 0.9, { gain: 0.35, from: 200, to: 2600, attack: 0.3, seed: 99 })
      .boom(0.62, 0.45, 90, 38, 0.5)
      .tone(NOTE(-21), 0.6, 0.5, { wave: "brass", gain: 0.07, attack: 0.02 })
      .space(0.15)
      .finish(0.75),
  wheelMove: () => {
    // Seamless loop: identical start/end via crossfaded noise bed.
    const m = new Mixer(1.2);
    m.noise(0, 1.2, { gain: 0.5, from: 380, to: 380, attack: 0.001, seed: 7 });
    const d = m.data;
    const xf = Math.floor(0.1 * SAMPLE_RATE);
    for (let i = 0; i < xf; i++) {
      const a = i / xf;
      d[i] = d[i] * a + d[d.length - xf + i] * (1 - a);
    }
    const out = d.slice(0, d.length - xf);
    let max = 0;
    for (const v of out) max = Math.max(max, Math.abs(v));
    for (let i = 0; i < out.length; i++) out[i] = (out[i] / (max || 1)) * 0.5;
    return out;
  },
  tick: () =>
    new Mixer(0.06)
      .noise(0, 0.03, { gain: 0.5, from: 3500, to: 3500, highpass: true, attack: 0.0005, seed: 3 })
      .pluck(2100, 0, 0.05, 0.25, "sine", 90)
      .finish(0.8),
  reveal: () => {
    const m = new Mixer(2.8);
    m.boom(0, 0.9, 130, 40, 0.55);
    [-21, -14, -9, -5, -2, 3].forEach((n, i) => m.tone(NOTE(n), 0.02 + i * 0.012, 2.2, { wave: "brass", gain: 0.085, attack: 0.04, release: 1.6, vibrato: 0.003 }));
    [15, 19, 22, 27].forEach((n, i) => m.pluck(NOTE(n), 0.25 + i * 0.07, 1.8, 0.12, "bell", 2.5));
    m.noise(0.1, 2.2, { gain: 0.05, from: 8000, to: 3000, highpass: true });
    return m.space(0.3).finish(0.85);
  },
  ui: () => new Mixer(0.08).pluck(880, 0, 0.07, 0.25, "sine", 60).pluck(1760, 0, 0.04, 0.08, "sine", 90).finish(0.6),
  special: () => {
    const m = new Mixer(2.6);
    m.noise(0, 0.9, { gain: 0.12, from: 400, to: 6000, attack: 0.5 });
    m.boom(0.85, 0.9, 120, 36, 0.55);
    [-9, -5, -2, 3, 7].forEach((n) => m.tone(NOTE(n), 0.85, 1.6, { wave: "brass", gain: 0.08, attack: 0.03, release: 1.2 }));
    [10, 15, 19, 22, 27, 31].forEach((n, i) => m.pluck(NOTE(n), 0.9 + i * 0.06, 1.5, 0.12, "bell", 2.8));
    return m.space(0.32).finish(0.85);
  },
};

export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Arena Cub sound effects (original, synthesized here; short and soft). */
export type CubSound = "intro" | "hungry" | "angry" | "sad" | "feeding" | "bonus";
export const CUB_SOUNDS: Record<CubSound, () => Float32Array> = {
  // friendly pop + little hop
  intro: () => new Mixer(0.7).pluck(NOTE(7), 0, 0.25, 0.3, "sine", 14).tone(NOTE(10), 0.12, 0.22, { wave: "triangle", gain: 0.18, glideTo: NOTE(19) }).pluck(NOTE(22), 0.3, 0.35, 0.18, "bell", 9).space(0.15).finish(0.6),
  // soft rising "mrrp?"
  hungry: () => new Mixer(0.6).tone(NOTE(-5), 0, 0.45, { wave: "triangle", gain: 0.2, attack: 0.04, glideTo: NOTE(2), vibrato: 0.02 }).finish(0.5),
  // comic pout: two short bouncy notes down
  angry: () => new Mixer(0.55).tone(NOTE(3), 0, 0.16, { wave: "triangle", gain: 0.2, glideTo: NOTE(-2) }).tone(NOTE(-2), 0.2, 0.22, { wave: "triangle", gain: 0.2, glideTo: NOTE(-9) }).finish(0.5),
  // small sad sigh
  sad: () => new Mixer(0.9).tone(NOTE(2), 0, 0.8, { wave: "sine", gain: 0.18, attack: 0.08, glideTo: NOTE(-7), vibrato: 0.012 }).finish(0.45),
  // happy munch-munch + chime
  feeding: () => {
    const m = new Mixer(1.1);
    [0, 0.14, 0.28].forEach((t, i) => m.noise(t, 0.08, { gain: 0.22, from: 900, to: 400, attack: 0.002, seed: 11 + i }));
    m.pluck(NOTE(19), 0.46, 0.6, 0.22, "bell", 6).pluck(NOTE(26), 0.54, 0.6, 0.2, "bell", 6);
    return m.space(0.18).finish(0.6);
  },
  // milestone chime
  bonus: () => {
    const m = new Mixer(1.4);
    [12, 16, 19, 24].forEach((n, i) => m.pluck(NOTE(n), i * 0.09, 0.9, 0.18, "bell", 4));
    return m.space(0.22).finish(0.6);
  },
};

/**
 * Teams Arena sale stingers (original, synthesized here; nothing licensed or sampled).
 *  royal:    Sigma, golden lion: timpani hit + a broad brass major chord + bright bells.
 *  electric: Panthers: a rising zap and noise sweep, a punchy hit, quick ascending brass stabs.
 *  neutral:  any other team: one hit and a short bright arpeggio.
 */
export type TeamStinger = "royal" | "electric" | "neutral";
export const TEAM_STINGERS: Record<TeamStinger, () => Float32Array> = {
  royal: () => {
    const m = new Mixer(2.4);
    m.boom(0, 0.7, 120, 38, 0.5).boom(0.42, 0.6, 105, 36, 0.38);
    [-21, -14, -9, -5, -2].forEach((n, i) => m.tone(NOTE(n), 0.04 + i * 0.01, 0.55, { wave: "brass", gain: 0.075, attack: 0.03, release: 0.3 }));
    [-17, -10, -5, -1, 2, 7].forEach((n) => m.tone(NOTE(n), 0.46, 1.7, { wave: "brass", gain: 0.07, attack: 0.05, release: 1.2, vibrato: 0.003 }));
    [14, 19, 23, 26].forEach((n, i) => m.pluck(NOTE(n), 0.5 + i * 0.06, 1.4, 0.1, "bell", 2.6));
    m.noise(0.42, 1.4, { gain: 0.04, from: 7000, to: 2500, highpass: true });
    return m.space(0.3).finish(0.85);
  },
  electric: () => {
    const m = new Mixer(1.9);
    m.noise(0, 0.4, { gain: 0.16, from: 600, to: 9000, attack: 0.25, highpass: true, seed: 21 });
    m.tone(NOTE(-12), 0, 0.38, { wave: "triangle", gain: 0.12, attack: 0.2, glideTo: NOTE(24) });
    m.boom(0.38, 0.45, 150, 45, 0.52);
    [-5, 0, 4, 7].forEach((n, i) => m.tone(NOTE(n), 0.4 + i * 0.075, 0.2, { wave: "brass", gain: 0.1, attack: 0.008, release: 0.12 }));
    [-5, 0, 4, 7, 12].forEach((n) => m.tone(NOTE(n), 0.72, 0.9, { wave: "brass", gain: 0.06, attack: 0.02, release: 0.7 }));
    m.tone(NOTE(31), 0.72, 0.18, { wave: "sine", gain: 0.06, glideTo: NOTE(19) }).tone(NOTE(33), 0.95, 0.14, { wave: "sine", gain: 0.05, glideTo: NOTE(21) });
    return m.space(0.24).finish(0.85);
  },
  neutral: () => {
    const m = new Mixer(1.5);
    m.boom(0, 0.45, 140, 50, 0.42);
    [0, 4, 7, 12, 16].forEach((n, i) => m.pluck(NOTE(n + 3), 0.05 + i * 0.06, 1.0, 0.16, "bell", 3.5));
    [3, 7, 10].forEach((n) => m.tone(NOTE(n - 12), 0.08, 0.9, { wave: "brass", gain: 0.06, attack: 0.04, release: 0.7 }));
    return m.space(0.25).finish(0.8);
  },
};

/**
 * Helper: layer festive sleigh-bell jingles (metallic high-frequency bell bursts + filtered shimmer)
 * onto a mixer at the given timestamps.
 */
function addSleighBells(m: Mixer, hits: number[], gain = 0.12): Mixer {
  hits.forEach((t, idx) => {
    m.noise(t, 0.095, { gain: gain * 0.7, from: 5200, to: 9200, highpass: true, attack: 0.003, seed: 401 + idx });
    m.pluck(NOTE(31), t, 0.16, gain * 0.55, "bell", 16);
    m.pluck(NOTE(36), t + 0.012, 0.14, gain * 0.45, "bell", 18);
    m.pluck(NOTE(39), t + 0.022, 0.12, gain * 0.35, "bell", 20);
  });
  return m;
}

/**
 * Helper: warm 3-syllable synthesized Santa "Ho! Ho! Ho!" baritone chuckle + sleigh bells.
 */
function renderSantaHoHoHo(): Float32Array {
  const m = new Mixer(1.55);
  // Three jovial baritone "Ho" syllables with vocal formants + bright bell sparkle
  [0.04, 0.42, 0.8].forEach((t, idx) => {
    const pitch = NOTE(-12 - idx); // A3 -> G#3 -> G3 warm chuckle cadence
    // aspirated "H" breath onset
    m.noise(t, 0.045, { gain: 0.09, from: 1400, to: 900, highpass: true, attack: 0.004, seed: 700 + idx });
    // fundamental baritone chest resonance + O-vowel harmonic formants
    m.tone(pitch, t + 0.02, 0.27, { wave: "brass", gain: 0.22, attack: 0.018, release: 0.16, glideTo: pitch * 0.88, vibrato: 0.012 });
    m.tone(pitch * 2, t + 0.02, 0.25, { wave: "triangle", gain: 0.14, attack: 0.018, release: 0.15, glideTo: pitch * 1.76 });
    m.tone(pitch * 3.1, t + 0.025, 0.2, { wave: "sine", gain: 0.07, attack: 0.015, release: 0.14 });
    m.boom(t + 0.02, 0.18, 135, 78, 0.16);
  });
  addSleighBells(m, [0.06, 0.24, 0.44, 0.62, 0.82, 1.02, 1.18], 0.11);
  // Festive holiday chime tail (C6 - E6 - G6 - C7)
  [15, 19, 22, 27].forEach((n, i) => m.pluck(NOTE(n), 0.92 + i * 0.07, 0.55, 0.15, "bell", 5));
  return m.space(0.24).finish(0.78);
}

/**
 * Christmas Edition sound generators (used when arenaTheme === "christmas" && christmasSounds === true).
 * Clean, joyful holiday bells, sleigh-bell shimmer, and warm brass chords.
 */
export const CHRISTMAS_GENERATORS: Partial<Record<SoundCategory, () => Float32Array>> = {
  sale: () => {
    const m = new Mixer(1.45);
    addSleighBells(m, [0, 0.16, 0.32, 0.48], 0.14);
    // Joyful holiday carol chime: C6 -> E6 -> G6 -> C7
    [15, 19, 22, 27].forEach((n, i) => m.pluck(NOTE(n), i * 0.095, 1.05, 0.26, "bell", 4.2));
    // Warm sub chime harmony
    [3, 7, 10, 15].forEach((n, i) => m.pluck(NOTE(n), 0.04 + i * 0.095, 0.95, 0.14, "triangle", 4));
    m.boom(0, 0.26, 150, 68, 0.2);
    return m.space(0.26).finish(0.75);
  },
  target: () => {
    const m = new Mixer(2.2);
    addSleighBells(m, [0, 0.18, 0.36, 0.54, 0.72, 0.9], 0.13);
    // Grand holiday fanfare + carol bells
    [3, 7, 10, 15, 19, 22, 27].forEach((n, i) => m.pluck(NOTE(n), i * 0.075, 1.5, 0.22, "bell", 3.2));
    [3, 7, 10, 15, 19].forEach((n) => m.tone(NOTE(n), 0.38, 1.55, { wave: "brass", gain: 0.065, attack: 0.07, release: 1.15, vibrato: 0.003 }));
    m.boom(0.36, 0.6, 115, 44, 0.34);
    return m.space(0.28).finish(0.82);
  },
  spinUnlocked: () => {
    const m = new Mixer(1.5);
    addSleighBells(m, [0, 0.14, 0.28, 0.42, 0.56], 0.13);
    [3, 7, 10, 15, 19, 22, 27, 31].forEach((n, i) => m.pluck(NOTE(n), i * 0.055, 0.75, 0.18, "bell", 5.2));
    return m.space(0.3).finish(0.74);
  },
  reveal: () => {
    const m = new Mixer(2.8);
    m.boom(0, 0.85, 128, 42, 0.5);
    addSleighBells(m, [0.05, 0.22, 0.4, 0.58, 0.76, 0.94], 0.14);
    [-17, -10, -5, -2, 3, 7].forEach((n, i) => m.tone(NOTE(n), 0.03 + i * 0.015, 2.2, { wave: "brass", gain: 0.08, attack: 0.04, release: 1.6, vibrato: 0.003 }));
    [15, 19, 22, 27, 31].forEach((n, i) => m.pluck(NOTE(n), 0.22 + i * 0.075, 1.85, 0.16, "bell", 2.4));
    return m.space(0.32).finish(0.85);
  },
  special: () => {
    const m = new Mixer(2.6);
    addSleighBells(m, [0, 0.18, 0.36, 0.54, 0.85, 1.05, 1.25], 0.13);
    m.boom(0.82, 0.85, 120, 38, 0.5);
    [-9, -5, -2, 3, 7].forEach((n) => m.tone(NOTE(n), 0.82, 1.6, { wave: "brass", gain: 0.075, attack: 0.03, release: 1.2 }));
    [15, 19, 22, 27, 31, 34].forEach((n, i) => m.pluck(NOTE(n), 0.86 + i * 0.06, 1.5, 0.15, "bell", 2.6));
    return m.space(0.32).finish(0.85);
  },
};

export type ChristmasCubExtraSound = "hohoho" | "jingle" | "chime";
export const CHRISTMAS_CUB_SOUNDS: Record<CubSound | ChristmasCubExtraSound, () => Float32Array> = {
  intro: () => {
    const m = new Mixer(0.95);
    addSleighBells(m, [0, 0.16, 0.32], 0.13);
    [15, 19, 22, 27].forEach((n, i) => m.pluck(NOTE(n), i * 0.075, 0.55, 0.2, "bell", 6));
    return m.space(0.2).finish(0.65);
  },
  hungry: CUB_SOUNDS.hungry,
  angry: CUB_SOUNDS.angry,
  sad: CUB_SOUNDS.sad,
  feeding: () => {
    const m = new Mixer(1.2);
    [0, 0.14, 0.28].forEach((t, i) => m.noise(t, 0.08, { gain: 0.2, from: 950, to: 420, attack: 0.002, seed: 31 + i }));
    addSleighBells(m, [0.42, 0.58, 0.74], 0.12);
    m.pluck(NOTE(19), 0.44, 0.65, 0.24, "bell", 5.5).pluck(NOTE(22), 0.52, 0.65, 0.22, "bell", 5.5).pluck(NOTE(27), 0.6, 0.7, 0.24, "bell", 5);
    return m.space(0.22).finish(0.65);
  },
  bonus: renderSantaHoHoHo,
  hohoho: renderSantaHoHoHo,
  jingle: () => {
    const m = new Mixer(1.25);
    addSleighBells(m, [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9], 0.16);
    // Jingle bell melody motif: E6 - E6 - E6 - G6 - C6 - D6 - E6
    [19, 19, 19, 22, 15, 17, 19].forEach((n, i) => m.pluck(NOTE(n), i * 0.13, 0.45, 0.2, "bell", 6.5));
    return m.space(0.22).finish(0.7);
  },
  chime: () => {
    const m = new Mixer(1.1);
    addSleighBells(m, [0, 0.18, 0.36], 0.12);
    [15, 19, 22, 27].forEach((n, i) => m.pluck(NOTE(n), i * 0.085, 0.75, 0.22, "bell", 4.8));
    return m.space(0.24).finish(0.68);
  },
};

export const CHRISTMAS_TEAM_STINGERS: Record<TeamStinger, () => Float32Array> = {
  royal: () => {
    const m = new Mixer(2.4);
    m.boom(0, 0.68, 120, 38, 0.48).boom(0.42, 0.58, 105, 36, 0.36);
    addSleighBells(m, [0.04, 0.22, 0.44, 0.62, 0.8, 0.98], 0.14);
    [-21, -14, -9, -5, -2].forEach((n, i) => m.tone(NOTE(n), 0.04 + i * 0.01, 0.55, { wave: "brass", gain: 0.072, attack: 0.03, release: 0.3 }));
    [-17, -10, -5, -1, 2, 7].forEach((n) => m.tone(NOTE(n), 0.46, 1.7, { wave: "brass", gain: 0.068, attack: 0.05, release: 1.2, vibrato: 0.003 }));
    [14, 19, 23, 26, 31].forEach((n, i) => m.pluck(NOTE(n), 0.48 + i * 0.06, 1.45, 0.15, "bell", 2.5));
    return m.space(0.3).finish(0.85);
  },
  electric: () => {
    const m = new Mixer(2.0);
    addSleighBells(m, [0, 0.16, 0.38, 0.56, 0.74, 0.92], 0.14);
    m.tone(NOTE(-12), 0, 0.36, { wave: "triangle", gain: 0.11, attack: 0.18, glideTo: NOTE(24) });
    m.boom(0.38, 0.45, 148, 45, 0.48);
    [-5, 0, 4, 7].forEach((n, i) => m.tone(NOTE(n), 0.4 + i * 0.075, 0.2, { wave: "brass", gain: 0.095, attack: 0.008, release: 0.12 }));
    [-5, 0, 4, 7, 12].forEach((n) => m.tone(NOTE(n), 0.72, 0.95, { wave: "brass", gain: 0.06, attack: 0.02, release: 0.72 }));
    [19, 24, 28, 31].forEach((n, i) => m.pluck(NOTE(n), 0.7 + i * 0.065, 1.1, 0.16, "bell", 3.2));
    return m.space(0.26).finish(0.85);
  },
  neutral: () => {
    const m = new Mixer(1.6);
    m.boom(0, 0.45, 140, 50, 0.4);
    addSleighBells(m, [0.02, 0.18, 0.36, 0.54], 0.13);
    [3, 7, 10, 15, 19, 22].forEach((n, i) => m.pluck(NOTE(n), 0.05 + i * 0.06, 1.05, 0.18, "bell", 3.4));
    [3, 7, 10].forEach((n) => m.tone(NOTE(n - 12), 0.08, 0.9, { wave: "brass", gain: 0.06, attack: 0.04, release: 0.7 }));
    return m.space(0.26).finish(0.8);
  },
};
