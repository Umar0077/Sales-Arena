#!/usr/bin/env node
// Renders the FE Sales Arena celebration sound package to public/audio/celebrations/*.wav.
//
//   node scripts/render-celebration-sounds.mjs
//
// Every sound is ORIGINAL and fully synthesized here (no samples, no recordings, no third-party audio): the lion
// roar and big-cat growl are stylized cinematic designs (a pitch-contoured pulse source plus breath / rasp noise
// through vocal-tract-like formant filters), not animal recordings. Deterministic: the same script always writes
// the same files. Plain Node, no dependencies. 44.1 kHz, 16-bit mono WAV, peak-limited with short fades.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SR = 44100;
const OUT = path.join(process.cwd(), "public", "audio", "celebrations");
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------- primitives
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
const at = (t) => Math.round(t * SR);
const lerp = (a, b, x) => a + (b - a) * x;
/** Piecewise-linear curve through [time, value] points. */
const curve = (pts) => (t) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], (t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]));
  return pts[pts.length - 1][1];
};
/** Same, but interpolated in log space (frequencies). */
const fcurve = (pts) => {
  const c = curve(pts.map(([t, f]) => [t, Math.log(f)]));
  return (t) => Math.exp(c(t));
};

/** RBJ biquad with per-sample (block-updated) parameters. */
class Biquad {
  constructor(type) {
    this.type = type;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  set(f, q, gainDb = 0) {
    const w = (TAU * Math.min(f, SR * 0.45)) / SR;
    const cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (this.type === "lp") [b0, b1, b2, a0, a1, a2] = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + al, -2 * cw, 1 - al];
    else if (this.type === "hp") [b0, b1, b2, a0, a1, a2] = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al, -2 * cw, 1 - al];
    else if (this.type === "bp") [b0, b1, b2, a0, a1, a2] = [al, 0, -al, 1 + al, -2 * cw, 1 - al];
    else if (this.type === "peak") {
      const A = Math.pow(10, gainDb / 40);
      [b0, b1, b2, a0, a1, a2] = [1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A];
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}
/** Filters a buffer region in place with time-varying frequency / Q. */
function filter(b, type, f, q = 0.707, from = 0, to = b.length / SR, gainDb = 0) {
  const bq = new Biquad(type);
  const fF = typeof f === "function" ? f : () => f;
  const qF = typeof q === "function" ? q : () => q;
  for (let i = at(from); i < Math.min(b.length, at(to)); i++) {
    if ((i & 31) === 0 || i === at(from)) bq.set(fF(i / SR), qF(i / SR), gainDb);
    b[i] = bq.run(b[i]);
  }
  return b;
}
const mix = (dst, src, t0 = 0, gain = 1) => {
  const o = at(t0);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * gain;
  return dst;
};
/** Band-limited saw (polyBLEP). */
function saw(phase, dt) {
  let v = 2 * phase - 1;
  if (phase < dt) { const t = phase / dt; v -= t + t - t * t - 1; }
  else if (phase > 1 - dt) { const t = (phase - 1) / dt; v -= t * t + t + t + 1; }
  return v;
}
/** Exponential-decay partial set (bells, coins, chimes). */
function partials(sec, f0, list, opts = {}) {
  const b = buf(sec);
  const { attack = 0.002 } = opts;
  for (const [ratio, amp, decay] of list) {
    const f = f0 * ratio;
    if (f > SR * 0.45) continue;
    let ph = Math.random() * 0; // deterministic phase 0
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      const env = Math.min(1, t / attack) * Math.exp(-t / decay);
      if (env < 1e-5 && t > attack) break;
      b[i] += Math.sin(ph) * amp * env;
      ph += (TAU * f) / SR;
    }
  }
  return b;
}
/** Soft electronic pluck: saw + sine body through a closing low-pass. */
function pluck(sec, f, { bright = 5000, dark = 900, decay = 0.14, body = 0.5 } = {}) {
  const b = buf(sec);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.003) * Math.exp(-t / decay);
    b[i] = (saw(ph, f / SR) * 0.6 + Math.sin(TAU * ph2) * body) * env;
    ph = (ph + f / SR) % 1;
    ph2 = (ph2 + f / SR) % 1;
  }
  return filter(b, "lp", (t) => lerp(dark, bright, Math.exp(-t / 0.05)), 0.9);
}
function noise(sec, seed) {
  const r = rng(seed), b = buf(sec);
  for (let i = 0; i < b.length; i++) b[i] = r() * 2 - 1;
  return b;
}
function envelope(b, fn) {
  for (let i = 0; i < b.length; i++) b[i] *= fn(i / SR);
  return b;
}
/** Low-passed random walk in [-1, 1] (pitch jitter, rasp). */
function wander(sec, seed, rate) {
  const r = rng(seed), b = buf(sec);
  let v = 0, target = 0;
  const step = Math.max(1, Math.round(SR / rate));
  for (let i = 0; i < b.length; i++) {
    if (i % step === 0) target = r() * 2 - 1;
    v += (target - v) * (rate / SR) * 4;
    b[i] = v;
  }
  return b;
}
/** Freeverb-style mono room (4 combs + 2 allpasses). */
function reverb(b, { mixAmt = 0.2, size = 0.82, damp = 0.35 } = {}) {
  const combs = [1557, 1617, 1491, 1422].map((n) => ({ d: new Float32Array(n), i: 0, s: 0 }));
  const aps = [556, 441].map((n) => ({ d: new Float32Array(n), i: 0 }));
  const out = new Float32Array(b.length);
  for (let n = 0; n < b.length; n++) {
    const x = b[n] * 0.12;
    let y = 0;
    for (const c of combs) {
      const o = c.d[c.i];
      c.s = o * (1 - damp) + c.s * damp;
      c.d[c.i] = x + c.s * size;
      c.i = (c.i + 1) % c.d.length;
      y += o;
    }
    for (const a of aps) {
      // Schroeder allpass (feedback 0.5)
      const o = a.d[a.i];
      a.d[a.i] = y + o * 0.5;
      a.i = (a.i + 1) % a.d.length;
      y = o - y;
    }
    out[n] = b[n] * (1 - mixAmt * 0.5) + y * mixAmt * 4;
  }
  return out;
}
/** Stylized creature vocal: pitch-contoured pulse + pulse-synchronous breath / rasp, through formants. */
function creature(sec, { f0, formants, rasp = 0.35, raspRate = 22, breath = 0.55, jitter = 0.04, seed = 1, sub = 0.35, env }) {
  const src = buf(sec), br = noise(sec, seed), jit = wander(sec, seed + 7, 9), rs = wander(sec, seed + 13, raspRate * 2);
  let ph = 0, subPh = 0;
  const subBuf = buf(sec);
  for (let i = 0; i < src.length; i++) {
    const t = i / SR;
    const f = f0(t) * (1 + jit[i] * jitter);
    const dt = f / SR;
    ph += dt;
    if (ph >= 1) ph -= 1;
    subPh += dt / 2;
    if (subPh >= 1) subPh -= 1;
    const pulse = saw(ph, dt);
    // breath is gated by the glottal cycle (louder at the start of each pulse): growly, not hissy
    const gate = 0.35 + 0.65 * Math.exp(-ph * 5);
    // rasp: an irregular amplitude flutter (vocal fry)
    const fry = 1 - rasp * (0.5 + 0.5 * Math.sin(TAU * raspRate * t + rs[i] * 2.5));
    src[i] = (pulse * 0.55 + br[i] * breath * gate) * fry;
    subBuf[i] = Math.sin(TAU * subPh) * sub;
  }
  const out = buf(sec);
  for (const [fc, q, g] of formants) {
    const band = Float32Array.from(src);
    filter(band, "bp", typeof fc === "function" ? fc : () => fc, q);
    mix(out, band, 0, g);
  }
  filter(subBuf, "lp", 160, 0.7);
  mix(out, subBuf, 0, 1);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.8) * env(i / SR); // body / saturation
  filter(out, "hp", 90, 0.7); // keep the voice in the range office speakers reproduce (no boomy sub)
  filter(out, "peak", 1800, 0.9, 0, sec, 3.5); // presence
  return filter(out, "lp", 4200, 0.6);
}
/** Cinematic sub impact: pitch-dropping sine + transient. */
function impact(sec, { from = 95, to = 38, decay = 0.35, click = 0.25, seed = 3 } = {}) {
  const b = buf(sec);
  let ph = 0;
  const fc = fcurve([[0, from], [0.25, to]]);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    ph += (TAU * fc(t)) / SR;
    b[i] = Math.sin(ph) * Math.min(1, t / 0.004) * Math.exp(-t / decay);
  }
  const n = envelope(noise(sec, seed), (t) => Math.exp(-t / 0.03) * click);
  filter(n, "bp", 1400, 0.8);
  return mix(b, n);
}
/** Noise whoosh with a band-pass sweep. */
function whoosh(sec, { from, to, q = 1.4, seed = 5, shape }) {
  const b = noise(sec, seed);
  filter(b, "bp", fcurve([[0, from], [sec, to]]), q);
  return envelope(b, shape);
}
/** Sparse high pings and hiss: the "shimmer". */
function sparkle(sec, { seed = 9, count = 9, lo = 3000, hi = 7500, gain = 0.12 } = {}) {
  const r = rng(seed), b = buf(sec);
  for (let k = 0; k < count; k++) {
    const t0 = r() * sec * 0.7, f = lo + r() * (hi - lo);
    mix(b, partials(0.5, f, [[1, 1, 0.09], [2.01, 0.3, 0.05]]), t0, gain * (0.6 + r() * 0.4) * Math.exp(-t0 / (sec * 0.6)));
  }
  const h = envelope(noise(sec, seed + 1), (t) => Math.min(1, t / 0.05) * Math.exp(-t / (sec * 0.35)) * gain * 0.35);
  filter(h, "hp", 7000, 0.7);
  return mix(b, h);
}
const BELL = [[1, 1, 0.9], [2.0, 0.5, 0.55], [2.76, 0.32, 0.35], [5.4, 0.16, 0.18], [8.93, 0.07, 0.1]];
const note = (n) => 440 * Math.pow(2, n / 12); // semitones from A4

/** DC cut, gentle bass control, peak-limit, loudness-match, fades. */
function master(b, { peakDb = -1.5, rmsDb = -17, fadeIn = 0.004, fadeOut = 0.12 } = {}) {
  filter(b, "hp", 32, 0.7);
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * 1.1) / 1.1; // soft safety
  let peak = 0, sq = 0, cnt = 0;
  for (const v of b) {
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) > 1e-3) { sq += v * v; cnt++; }
  }
  const rms = Math.sqrt(sq / Math.max(1, cnt));
  const g = Math.min(Math.pow(10, peakDb / 20) / peak, Math.pow(10, rmsDb / 20) / rms);
  const fi = at(fadeIn), fo = at(fadeOut);
  for (let i = 0; i < b.length; i++) {
    let e = g;
    if (i < fi) e *= i / fi;
    if (i > b.length - fo) e *= Math.max(0, (b.length - i) / fo);
    b[i] *= e;
  }
  return b;
}

// ---------------------------------------------------------------------------------------------- the sounds
/** 1. Validated sale: "Ta-ta-TING!" (E5 pluck, B5 pluck, E6 bright chime, shimmer). ~1.2 s */
function saleChime() {
  const sec = 1.25, b = buf(sec);
  mix(b, pluck(0.35, note(7), { bright: 4200, dark: 1100, decay: 0.09 }), 0, 0.42);
  mix(b, pluck(0.35, note(14), { bright: 5200, dark: 1300, decay: 0.1 }), 0.085, 0.46);
  mix(b, partials(1.1, note(19), BELL), 0.18, 0.62); // E6: the "TING"
  mix(b, partials(1.0, note(26), [[1, 1, 0.5], [2.0, 0.3, 0.25]]), 0.185, 0.16); // B6 sweetener
  const tick = envelope(noise(0.02, 11), (t) => Math.exp(-t / 0.003));
  mix(b, filter(tick, "bp", 7000, 1.2), 0.18, 0.25);
  mix(b, sparkle(0.9, { seed: 21, count: 6, gain: 0.08 }), 0.28);
  return master(reverb(b, { mixAmt: 0.18, size: 0.78 }), { rmsDb: -19 });
}

/** 2. Team Sigma: whoosh → stylized lion roar → bass impact → golden shimmer → fade. ~2.2 s */
function sigmaLion() {
  const sec = 2.25, b = buf(sec);
  mix(b, whoosh(0.45, { from: 260, to: 2600, q: 1.1, seed: 31, shape: (t) => Math.pow(Math.min(1, t / 0.32), 2) * (t > 0.32 ? Math.exp(-(t - 0.32) / 0.05) : 1) }), 0, 0.3);
  const roar = creature(1.45, {
    seed: 41,
    f0: fcurve([[0, 78], [0.18, 112], [0.42, 124], [0.75, 108], [1.1, 82], [1.45, 64]]),
    formants: [
      [fcurve([[0, 480], [0.3, 640], [0.9, 600], [1.45, 460]]), 3.2, 1.0],
      [fcurve([[0, 1050], [0.3, 1250], [1.45, 980]]), 4.0, 0.62],
      [2550, 5.0, 0.26],
      [3600, 6.0, 0.1],
    ],
    rasp: 0.32,
    raspRate: 19,
    breath: 0.6,
    jitter: 0.05,
    sub: 0.16,
    env: (t) => Math.min(1, Math.pow(t / 0.2, 1.6)) * (t < 0.85 ? 1 : Math.exp(-(t - 0.85) / 0.22)),
  });
  mix(b, roar, 0.2, 0.95);
  mix(b, impact(0.9, { from: 92, to: 42, decay: 0.28, click: 0.3, seed: 43 }), 0.55, 0.42);
  const gold = buf(1.2);
  [16, 20, 23, 28].forEach((n, i) => mix(gold, partials(1.1, note(n), BELL), i * 0.045, 0.2));
  mix(b, gold, 1.0, 0.75);
  mix(b, sparkle(1.1, { seed: 47, count: 8, gain: 0.1, lo: 3500, hi: 8000 }), 1.02);
  const out = reverb(b, { mixAmt: 0.24, size: 0.84, damp: 0.4 });
  envelope(out, (t) => (t < 1.6 ? 1 : Math.max(0, Math.cos(((t - 1.6) / 0.62) * Math.PI * 0.5))));
  return master(out, { rmsDb: -17, fadeOut: 0.05 });
}

/** 3. Team Panthers: electric sweep → big-cat growl → sharp whoosh → electric impact → energy tail. ~2.0 s */
function panthersGrowl() {
  const sec = 2.05, b = buf(sec);
  // electric energy sweep: a rising saw zap with sparse crackle
  const zap = buf(0.3);
  let ph = 0;
  const zf = fcurve([[0, 180], [0.26, 2600]]);
  for (let i = 0; i < zap.length; i++) {
    const t = i / SR, f = zf(t);
    ph = (ph + f / SR) % 1;
    zap[i] = saw(ph, f / SR) * Math.min(1, t / 0.02) * (t < 0.24 ? 1 : Math.exp(-(t - 0.24) / 0.02));
  }
  filter(zap, "bp", fcurve([[0, 500], [0.26, 4200]]), 1.6);
  mix(b, zap, 0, 0.32);
  const r = rng(51);
  const crackle = buf(0.3);
  for (let k = 0; k < 14; k++) mix(crackle, envelope(noise(0.012, 60 + k), (t) => Math.exp(-t / 0.002)), r() * 0.28, 0.5 + r() * 0.5);
  mix(b, filter(crackle, "hp", 3500, 0.7), 0, 0.12);
  const growl = creature(0.95, {
    seed: 53,
    f0: fcurve([[0, 58], [0.12, 74], [0.45, 70], [0.95, 52]]),
    formants: [
      [fcurve([[0, 360], [0.2, 470], [0.95, 380]]), 3.0, 1.0],
      [fcurve([[0, 860], [0.3, 980], [0.95, 820]]), 4.0, 0.55],
      [2050, 5.0, 0.22],
    ],
    rasp: 0.5,
    raspRate: 27,
    breath: 0.7,
    jitter: 0.06,
    sub: 0.2,
    env: (t) => Math.min(1, t / 0.08) * (t < 0.55 ? 1 : Math.exp(-(t - 0.55) / 0.16)),
  });
  mix(b, growl, 0.2, 0.92);
  mix(b, whoosh(0.32, { from: 3400, to: 420, q: 1.5, seed: 57, shape: (t) => Math.sin(Math.min(1, t / 0.3) * Math.PI) }), 0.55, 0.42);
  // electric victory hit: transient + short power chord + controlled crackle
  mix(b, impact(0.7, { from: 120, to: 48, decay: 0.2, click: 0.45, seed: 59 }), 0.85, 0.42);
  const chord = buf(0.6);
  for (const [f, g] of [[note(-24), 0.5], [note(-17), 0.4], [note(-12), 0.3]]) {
    let p1 = 0, p2 = 0;
    for (let i = 0; i < chord.length; i++) {
      const t = i / SR;
      p1 = (p1 + (f * 1.003) / SR) % 1;
      p2 = (p2 + (f * 0.997) / SR) % 1;
      chord[i] += (saw(p1, f / SR) + saw(p2, f / SR)) * 0.5 * g * Math.min(1, t / 0.004) * Math.exp(-t / 0.2);
    }
  }
  mix(b, filter(chord, "lp", fcurve([[0, 3800], [0.5, 700]]), 0.8), 0.85, 0.5);
  const crackle2 = buf(0.35);
  for (let k = 0; k < 10; k++) mix(crackle2, envelope(noise(0.01, 80 + k), (t) => Math.exp(-t / 0.0018)), r() * 0.3, 0.4 + r() * 0.4);
  mix(b, filter(crackle2, "hp", 4500, 0.7), 0.86, 0.09);
  // fading energy tail: a cool band-passed hum with a slow shimmer
  const tail = envelope(noise(0.9, 61), (t) => Math.min(1, t / 0.08) * Math.exp(-t / 0.28) * (0.75 + 0.25 * Math.sin(TAU * 7 * t)));
  mix(b, filter(tail, "bp", 1700, 2.2), 1.1, 0.22);
  const out = reverb(b, { mixAmt: 0.2, size: 0.8, damp: 0.5 });
  envelope(out, (t) => (t < 1.35 ? 1 : Math.max(0, Math.cos(((t - 1.35) / 0.7) * Math.PI * 0.5))));
  return master(out, { rmsDb: -17, fadeOut: 0.05 });
}

/** 4. Cash bonus: "Pa-pa-pa-CHING!" three coins → ascending flourish → golden ching → sparkle. ~1.7 s */
function cashBonus() {
  const sec = 1.75, b = buf(sec);
  const COIN = [[1, 1, 0.07], [1.53, 0.6, 0.06], [2.37, 0.42, 0.045], [3.11, 0.25, 0.035], [4.2, 0.15, 0.025]];
  [[note(26), 0.01], [note(28), 0.12], [note(31), 0.23]].forEach(([f, t0], i) => {
    mix(b, partials(0.3, f, COIN), t0, 0.42 + i * 0.04);
    mix(b, filter(envelope(noise(0.01, 70 + i), (t) => Math.exp(-t / 0.0015)), "bp", 8000, 1), t0, 0.14);
  });
  [note(10), note(14), note(17), note(22)].forEach((f, i) => mix(b, pluck(0.3, f, { bright: 6500, dark: 1800, decay: 0.08, body: 0.6 }), 0.4 + i * 0.07, 0.3));
  // "CHING": a bright register bell + a short sizzle + a soft golden chord under it
  mix(b, partials(1.0, note(29), [[1, 1, 0.75], [2.0, 0.45, 0.45], [2.76, 0.3, 0.3], [4.07, 0.2, 0.18], [5.4, 0.12, 0.12]]), 0.75, 0.7);
  mix(b, filter(envelope(noise(0.09, 77), (t) => Math.exp(-t / 0.025)), "bp", 7500, 0.9), 0.75, 0.3);
  const pad = buf(0.9);
  for (const n of [10, 14, 17, 22]) {
    let p = 0;
    for (let i = 0; i < pad.length; i++) {
      const t = i / SR;
      p += (TAU * note(n)) / SR;
      pad[i] += Math.sin(p) * 0.25 * Math.min(1, t / 0.02) * Math.exp(-t / 0.35);
    }
  }
  mix(b, pad, 0.75, 0.35);
  mix(b, sparkle(0.7, { seed: 79, count: 10, gain: 0.11, lo: 4000, hi: 9000 }), 1.08);
  return master(reverb(b, { mixAmt: 0.16, size: 0.76 }), { rmsDb: -18 });
}

// ---------------------------------------------------------------------------------------------- output
function wav(samples) {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return out;
}

const SOUNDS = {
  "sale-validated-chime.wav": saleChime,
  "sigma-lion-roar-victory.wav": sigmaLion,
  "panthers-big-cat-growl-victory.wav": panthersGrowl,
  "cash-bonus-golden-ching.wav": cashBonus,
};
mkdirSync(OUT, { recursive: true });
for (const [name, fn] of Object.entries(SOUNDS)) {
  const s = fn();
  let peak = 0;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  const data = wav(s);
  writeFileSync(path.join(OUT, name), data);
  console.log(`${name}  ${(s.length / SR).toFixed(2)} s  ${(data.length / 1024).toFixed(0)} KB  peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
}
