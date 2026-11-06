#!/usr/bin/env node
// Renders the cash-bonus celebration sound from the Owner-supplied trumpet recording:
//
//   node scripts/render-cash-bonus-sound.mjs
//
// Input : assets/audio/originals/mind_out_of_office-trumpet-blasts-sound-music-244011.mp3 (supplied by the Owner)
// Output: public/audio/celebrations/cash-bonus-trumpet.wav (44.1 kHz, 16-bit stereo)
//
// The trumpet recording is the dominant, unchanged part (only leading / trailing silence trimmed and a smooth fade at
// the end). Underneath it, at low level, three ORIGINAL layers synthesized here: a soft cinematic impact on the first
// blast, a high golden shimmer, and an airy uplifting texture (unpitched, so it never clashes with the trumpet's key).
// Then a gentle compressor, a peak limit (−1.5 dBFS, no clipping) and a fade-out. Decoding and mixing run in the
// Chromium that Playwright installs (Web Audio OfflineAudioContext): no other tool or dependency is needed.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const SRC = path.join(process.cwd(), "assets", "audio", "originals", "mind_out_of_office-trumpet-blasts-sound-music-244011.mp3");
const OUT = path.join(process.cwd(), "public", "audio", "celebrations", "cash-bonus-trumpet.wav");
/** Length of the result (Owner choice: 3 s), well inside the shortest bonus popup (Daily, 6 s). */
const MAX_SEC = 3.0;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const result = await page.evaluate(
    async ({ b64, MAX_SEC }) => {
      const SR = 44100;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const probe = new OfflineAudioContext(2, SR, SR);
      const trumpet = await probe.decodeAudioData(bytes.buffer.slice(0));
      // --- analyse: trim silence (keep 10 ms before the first sound and the full natural tail)
      const ch = Array.from({ length: trumpet.numberOfChannels }, (_, i) => trumpet.getChannelData(i));
      const amp = (i) => Math.max(...ch.map((c) => Math.abs(c[i])));
      const thrStart = Math.pow(10, -45 / 20), thrEnd = Math.pow(10, -55 / 20);
      let first = 0;
      while (first < trumpet.length && amp(first) < thrStart) first++;
      let last = trumpet.length - 1;
      while (last > first && amp(last) < thrEnd) last--;
      const start = Math.max(0, first - Math.round(0.01 * SR));
      const usable = (last - start) / SR;
      const dur = Math.min(MAX_SEC, usable + 0.15);
      // 3 s ends inside the trumpet phrase: a longer, smooth fade so it closes naturally, never a cut
      const fadeOut = Math.min(0.8, dur * 0.22);
      let origPeak = 0;
      for (const c of ch) for (let i = 0; i < c.length; i++) origPeak = Math.max(origPeak, Math.abs(c[i]));

      // --- mix
      const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
      const master = ctx.createDynamicsCompressor();
      master.threshold.value = -14;
      master.knee.value = 8;
      master.ratio.value = 2.5;
      master.attack.value = 0.006;
      master.release.value = 0.22;
      const lowCut = ctx.createBiquadFilter();
      lowCut.type = "highpass";
      lowCut.frequency.value = 38; // no rumble, no excessive bass
      lowCut.connect(master).connect(ctx.destination);

      // 1. the trumpet recording: dominant, unchanged, smooth fade at the end
      const tr = ctx.createBufferSource();
      tr.buffer = trumpet;
      const trGain = ctx.createGain();
      trGain.gain.setValueAtTime(1, 0);
      trGain.gain.setValueAtTime(1, dur - fadeOut);
      trGain.gain.linearRampToValueAtTime(0, dur);
      tr.connect(trGain).connect(lowCut);
      tr.start(0, start / SR);

      // deterministic noise
      let seed = 1234567;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
      const noiseBuf = (sec) => {
        const b = ctx.createBuffer(2, Math.ceil(sec * SR), SR);
        for (let c = 0; c < 2; c++) {
          const d = b.getChannelData(c);
          for (let i = 0; i < d.length; i++) d[i] = rnd();
        }
        return b;
      };

      // 2. soft cinematic impact under the first blast
      const boom = ctx.createOscillator();
      boom.type = "sine";
      boom.frequency.setValueAtTime(92, 0.01);
      boom.frequency.exponentialRampToValueAtTime(46, 0.4);
      const boomG = ctx.createGain();
      boomG.gain.setValueAtTime(0, 0);
      boomG.gain.linearRampToValueAtTime(0.12, 0.016);
      boomG.gain.exponentialRampToValueAtTime(0.0008, 0.7);
      boom.connect(boomG).connect(lowCut);
      boom.start(0);
      boom.stop(0.75);
      const hit = ctx.createBufferSource();
      hit.buffer = noiseBuf(0.25);
      const hitF = ctx.createBiquadFilter();
      hitF.type = "bandpass";
      hitF.frequency.value = 1100;
      hitF.Q.value = 0.8;
      const hitG = ctx.createGain();
      hitG.gain.setValueAtTime(0.05, 0.01);
      hitG.gain.exponentialRampToValueAtTime(0.0005, 0.18);
      hit.connect(hitF).connect(hitG).connect(lowCut);
      hit.start(0.01);

      // 3. golden shimmer: short, very high sparkles spread across the stereo field (above the trumpet's range)
      for (let k = 0; k < 16; k++) {
        const t0 = 0.12 + Math.abs(rnd()) * Math.min(3.0, dur - 1.2);
        const f = 5200 + Math.abs(rnd()) * 3800;
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const g = ctx.createGain();
        const level = 0.018 * (1 - t0 / (dur + 1));
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(level, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.00005, t0 + 0.28);
        const pan = ctx.createStereoPanner();
        pan.pan.value = rnd() * 0.8;
        o.connect(g).connect(pan).connect(lowCut);
        o.start(t0);
        o.stop(t0 + 0.3);
      }
      const air = ctx.createBufferSource();
      air.buffer = noiseBuf(dur);
      const airF = ctx.createBiquadFilter();
      airF.type = "highpass";
      airF.frequency.value = 7000;
      const airG = ctx.createGain();
      airG.gain.setValueAtTime(0, 0);
      airG.gain.linearRampToValueAtTime(0.012, 0.35);
      airG.gain.exponentialRampToValueAtTime(0.0004, Math.min(dur, 3.2));
      air.connect(airF).connect(airG).connect(lowCut);
      air.start(0);

      // 4. uplifting texture: a soft, slowly opening band of air that swells with the trumpet and fades before it
      const bed = ctx.createBufferSource();
      bed.buffer = noiseBuf(dur);
      const bedF = ctx.createBiquadFilter();
      bedF.type = "bandpass";
      bedF.Q.value = 0.6;
      bedF.frequency.setValueAtTime(1800, 0);
      bedF.frequency.exponentialRampToValueAtTime(4200, dur * 0.8);
      const bedG = ctx.createGain();
      bedG.gain.setValueAtTime(0, 0);
      bedG.gain.linearRampToValueAtTime(0.022, 0.9);
      bedG.gain.setValueAtTime(0.022, dur * 0.55);
      bedG.gain.linearRampToValueAtTime(0, dur - 0.1);
      bed.connect(bedF).connect(bedG).connect(lowCut);
      bed.start(0);

      const out = await ctx.startRendering();
      // --- peak limit to −1.5 dBFS (gain only), 20 ms fade-in guard, final 120 ms fade-out guard
      const L = out.getChannelData(0), R = out.getChannelData(1);
      let peak = 0;
      for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      const g = Math.pow(10, -1.5 / 20) / peak;
      const fi = Math.round(0.004 * SR), fo = Math.round(0.12 * SR);
      const pcm = new Int16Array(L.length * 2);
      for (let i = 0; i < L.length; i++) {
        let e = g;
        if (i < fi) e *= i / fi;
        if (i > L.length - fo) e *= (L.length - i) / fo;
        pcm[i * 2] = Math.round(Math.max(-1, Math.min(1, L[i] * e)) * 32767);
        pcm[i * 2 + 1] = Math.round(Math.max(-1, Math.min(1, R[i] * e)) * 32767);
      }
      let bin = "";
      const u8 = new Uint8Array(pcm.buffer);
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return {
        pcm: btoa(bin),
        info: { sourceSec: trumpet.duration, sourceChannels: trumpet.numberOfChannels, sourceRate: trumpet.sampleRate, trimStartSec: start / SR, usableSec: usable, outSec: dur, fadeOutSec: fadeOut, sourcePeakDb: 20 * Math.log10(origPeak), mixGainDb: 20 * Math.log10(g) },
      };
    },
    { b64: readFileSync(SRC).toString("base64"), MAX_SEC },
  );
  const pcm = Buffer.from(result.pcm, "base64");
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(44100, 24);
  h.writeUInt32LE(44100 * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.concat([h, pcm]));
  const r = result.info;
  console.log(
    `trumpet: ${r.sourceSec.toFixed(2)} s, ${r.sourceChannels} ch, ${r.sourceRate} Hz, peak ${r.sourcePeakDb.toFixed(1)} dBFS; trimmed ${(r.trimStartSec * 1000).toFixed(0)} ms of leading silence, ${r.usableSec.toFixed(2)} s of sound`,
  );
  console.log(`output: ${path.relative(process.cwd(), OUT)}  ${r.outSec.toFixed(2)} s  ${(pcm.length / 1024 + 0.04).toFixed(0)} KB  fade-out ${r.fadeOutSec.toFixed(2)} s  level ${r.mixGainDb.toFixed(1)} dB to a −1.5 dBFS peak`);
} finally {
  await browser.close();
}
