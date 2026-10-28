/**
 * Original synthesized sound effects (no external/proprietary assets).
 * Each generator renders a mono Float32Array that is encoded as WAV and
 * played through Howler.js.
 */
import type { SoundCategory } from "@/types";

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
