import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { CELEBRATION_SOUNDS, __resetCelebrationSounds, playCelebrationSound, stopCelebrationSound } from "@/frontend/audio/celebration-sounds";
import { playTeamStinger, stingerFor } from "@/frontend/audio/team-stingers";
import { GENERATORS, TEAM_STINGERS } from "@/frontend/audio/synth";

/**
 * The validated-sale sound and the Sigma / Panthers team sounds are the ORIGINAL synthesized sounds of 63f3fbf (the
 * release before the four-sound package). These fingerprints were taken from 63f3fbf's lib/audio/synth.ts: any change
 * to those sounds fails here.
 */
const ORIGINAL_63F3FBF = {
  sale: "6e0ff6d0ed66a9a369face73749e0e9e65be03d034f1d037b8ad09876581683b",
  royal: "691bdca28f18f4422300e4c49c10c4ba0f8b3d35919c2dbf81a147307cc4c4d7",
  electric: "bff2c45715c329b8375f6a51e2285aa11f35982bf2ec30523c523609c77faf3d",
  neutral: "5ff0a7585ce3d300cca7108e08a574e4a12eba2ce3803cee02167972ff156864",
};
const sha = (a: Float32Array) => createHash("sha256").update(Buffer.from(a.buffer)).digest("hex");

describe("original sounds restored (exact)", () => {
  it("normal validated sale = the original engine 'sale' sound, sample for sample", () => {
    expect(sha(GENERATORS.sale())).toBe(ORIGINAL_63F3FBF.sale);
  });
  it("Team Sigma / Team Panthers / other teams = the original stingers, sample for sample", () => {
    expect(stingerFor("lion")).toBe("royal");
    expect(stingerFor("panther")).toBe("electric");
    expect(stingerFor("crest")).toBe("neutral");
    expect(sha(TEAM_STINGERS.royal())).toBe(ORIGINAL_63F3FBF.royal);
    expect(sha(TEAM_STINGERS.electric())).toBe(ORIGINAL_63F3FBF.electric);
    expect(sha(TEAM_STINGERS.neutral())).toBe(ORIGINAL_63F3FBF.neutral);
  });
  it("only the cash bonus uses a recorded file; the old synthesized package files are gone", () => {
    expect(Object.keys(CELEBRATION_SOUNDS)).toEqual(["bonus"]);
    for (const f of ["sale-validated-chime", "sigma-lion-roar-victory", "panthers-big-cat-growl-victory", "cash-bonus-golden-ching"])
      expect(() => statSync(path.join("public", "audio", "celebrations", `${f}.wav`))).toThrow();
  });
});

describe("cash bonus trumpet file", () => {
  it("a real 44.1 kHz stereo WAV, 3 s (well inside every bonus popup), never clipping, faded in and out", () => {
    const b = readFileSync(path.join("public", CELEBRATION_SOUNDS.bonus.src));
    expect(b.toString("ascii", 0, 4)).toBe("RIFF");
    expect(b.toString("ascii", 8, 12)).toBe("WAVE");
    const sr = b.readUInt32LE(24), ch = b.readUInt16LE(22), bits = b.readUInt16LE(34);
    expect({ sr, ch, bits }).toEqual({ sr: 44100, ch: 2, bits: 16 });
    const frames = (b.length - 44) / 4;
    const sec = frames / sr;
    expect(sec).toBeGreaterThan(2.9);
    expect(sec).toBeLessThan(3.1); // Owner choice: 3 s (the shortest bonus popup is 6 s)
    let peak = 0, head = 0, tail = 0;
    for (let i = 0; i < frames * 2; i++) {
      const v = Math.abs(b.readInt16LE(44 + i * 2)) / 32768;
      peak = Math.max(peak, v);
      if (i < sr * 0.002 * 2) head = Math.max(head, v);
      if (i > (frames - sr * 0.002) * 2) tail = Math.max(tail, v);
    }
    expect(20 * Math.log10(peak)).toBeLessThanOrEqual(-1.4);
    expect(20 * Math.log10(peak)).toBeGreaterThan(-6);
    expect(head).toBeLessThan(0.05);
    expect(tail).toBeLessThan(0.02);
    expect(statSync(path.join("public", CELEBRATION_SOUNDS.bonus.src)).size / 1024).toBeLessThan(600);
  });
  it("the Owner's source recording is kept with the project (the WAV is rebuilt from it by scripts/render-cash-bonus-sound.mjs)", () => {
    expect(statSync(path.join("assets", "audio", "originals", "mind_out_of_office-trumpet-blasts-sound-music-244011.mp3")).size).toBeGreaterThan(100_000);
  });
});

describe("sound player rules (unchanged reliability)", () => {
  beforeEach(() => __resetCelebrationSounds());
  it("muted when the switches say so", () => {
    expect(playCelebrationSound("bonus", { allowed: false, key: "A" })).toBe("muted");
  });
  it("never plays before the browser allowed audio (autoplay); never queued for later", () => {
    expect(playCelebrationSound("bonus", { allowed: true, key: "B" })).toBe("locked");
  });
  it("one popup, one sound: the same key never replays", () => {
    expect(playCelebrationSound("bonus", { allowed: true, key: "C1" })).toBe("locked");
    expect(playCelebrationSound("bonus", { allowed: true, key: "C1" })).toBe("duplicate");
    expect(playCelebrationSound("bonus", { allowed: true, key: "C2" })).toBe("locked");
  });
  it("team stingers keep their original switches", () => {
    expect(playTeamStinger("lion", { soundEnabled: true, saleCategory: true, teamSaleSound: false })).toBe("muted");
    expect(playTeamStinger("panther", { soundEnabled: false, saleCategory: true, teamSaleSound: true })).toBe("muted");
    expect(playTeamStinger("lion", { soundEnabled: true, saleCategory: true, teamSaleSound: true })).toBe("locked");
  });
  it("stop (with a fade) when nothing is playing is harmless", () => {
    expect(() => stopCelebrationSound(["bonus"], 0.45)).not.toThrow();
  });
});
