import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { CELEBRATION_SOUNDS, __resetCelebrationSounds, playCelebrationSound, stopCelebrationSound } from "@/frontend/audio/celebration-sounds";
import { playTeamStinger } from "@/frontend/audio/team-stingers";

/** Reads a 16-bit PCM WAV: sample rate, channels, duration and peak (dBFS). */
function wavInfo(file: string) {
  const b = readFileSync(file);
  expect(b.toString("ascii", 0, 4)).toBe("RIFF");
  expect(b.toString("ascii", 8, 12)).toBe("WAVE");
  const sr = b.readUInt32LE(24), ch = b.readUInt16LE(22), bits = b.readUInt16LE(34);
  const n = (b.length - 44) / 2;
  let peak = 0, head = 0, tail = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(b.readInt16LE(44 + i * 2)) / 32768;
    peak = Math.max(peak, v);
    if (i < sr * 0.002) head = Math.max(head, v);
    if (i > n - sr * 0.002) tail = Math.max(tail, v);
  }
  return { sr, ch, bits, sec: n / sr, peakDb: 20 * Math.log10(peak), head, tail, kb: statSync(file).size / 1024 };
}

describe("celebration sound files", () => {
  const expectSec: Record<string, [number, number]> = { sale: [0.8, 1.4], sigma: [1.6, 2.3], panthers: [1.3, 2.1], bonus: [1.2, 2.0] };
  for (const [id, s] of Object.entries(CELEBRATION_SOUNDS)) {
    it(`${id}: real WAV in public/, the requested length, never clipping, fades in and out`, () => {
      const info = wavInfo(path.join("public", s.src));
      expect(info).toMatchObject({ sr: 44100, ch: 1, bits: 16 });
      expect(info.sec).toBeGreaterThanOrEqual(expectSec[id][0]);
      expect(info.sec).toBeLessThanOrEqual(expectSec[id][1]);
      expect(info.peakDb).toBeLessThanOrEqual(-1.4); // headroom: no clipping, no startling peaks
      expect(info.peakDb).toBeGreaterThan(-12); // and audible
      expect(info.head).toBeLessThan(0.05); // short fade in (no click)
      expect(info.tail).toBeLessThan(0.02); // faded out
      expect(info.kb).toBeLessThan(260);
    });
  }
});

describe("celebration sound player rules", () => {
  beforeEach(() => __resetCelebrationSounds());
  it("respects the switches: muted when not allowed", () => {
    expect(playCelebrationSound("sale", { allowed: false, key: "A" })).toBe("muted");
  });
  it("never plays before the browser allowed audio (autoplay); never queues it for later", () => {
    expect(playCelebrationSound("bonus", { allowed: true, key: "B" })).toBe("locked");
  });
  it("one event, one sound: the same key never replays (re-render, data refresh, repeated event)", () => {
    expect(playCelebrationSound("sale", { allowed: true, key: "C1" })).toBe("locked");
    expect(playCelebrationSound("sale", { allowed: true, key: "C1" })).toBe("duplicate");
    expect(playCelebrationSound("sale", { allowed: true, key: "C2" })).toBe("locked"); // another sale: its own sound
    expect(playCelebrationSound("bonus", { allowed: true, key: "C1" })).toBe("locked"); // keys are per sound
  });
  it("team stingers: Sigma / Panthers use the files and the same once-per-sale rule; switches still mute", () => {
    expect(playTeamStinger("lion", { soundEnabled: true, saleCategory: true, teamSaleSound: false }, "S1")).toBe("muted");
    expect(playTeamStinger("lion", { soundEnabled: true, saleCategory: true, teamSaleSound: true }, "S2")).toBe("locked");
    expect(playTeamStinger("lion", { soundEnabled: true, saleCategory: true, teamSaleSound: true }, "S2")).toBe("duplicate");
    expect(playTeamStinger("panther", { soundEnabled: false, saleCategory: true, teamSaleSound: true }, "P1")).toBe("muted");
  });
  it("stop with nothing playing is harmless", () => {
    expect(() => stopCelebrationSound()).not.toThrow();
  });
});
