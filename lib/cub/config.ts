/**
 * Arena Cub configuration: shared by the server validator (admin_settings "arena.config" → arenaCub)
 * and the browser. No "use client": safe to import in route handlers.
 */

export type CubScreen = "daily" | "weekly" | "monthly" | "teams" | "spin";
export type CubDialogue = "intro" | "hungry" | "angry" | "sad" | "feeding" | "bonus";
export type CubIntroFrequency = "every_load" | "hourly" | "daily" | "off";
/** Home position. "auto" is the legacy value (same as bottom-right). */
export type CubPosition = "auto" | "bottom-right" | "bottom-left" | "bottom-center" | "custom";
export type CubSizePreset = "small" | "medium" | "large" | "xl" | "custom";
export type CubIntensity = "calm" | "standard" | "lively";
export type CubPerformance = "auto" | "full" | "lite";
export type CubReducedMotion = "system" | "always";

export interface ArenaCubConfig {
  /**
   * Public permission. The cub appears on public Live Arena screens ONLY when this is true (and the
   * other switches allow it). Default OFF; a missing value is OFF. The Admin preview ignores it.
   */
  allowOnLiveArena: boolean;
  enabled: boolean;
  screens: Record<CubScreen, boolean>;
  intro: boolean;
  feeding: boolean;
  bonus: boolean;
  hunger: boolean;
  angry: boolean;
  sad: boolean;
  speech: boolean;
  sounds: boolean;
  particles: boolean;
  dialogue: Record<CubDialogue, boolean>;
  /** Minutes without a new validated sale (during active hours) before each mood. */
  hungerMin: number;
  angryMin: number;
  sadMin: number;
  /** A short reminder plays at hungerMin and then every reminderEveryMin while it stays quiet. */
  reminderEveryMin: number;
  /** No reminder within this many minutes of any other cub performance (celebration, intro, reminder). */
  reminderCooldownMin: number;
  introFrequency: CubIntroFrequency;
  bubbleSec: number;
  feedingSec: number;
  bonusSec: number;
  /** Active sales hours in the business timezone ("HH:MM"). Outside them the cub sleeps, no reminders. */
  activeStart: string;
  activeEnd: string;
  /** Weekdays with active hours (0 = Sunday … 6 = Saturday). */
  activeDays: number[];
  /** Size preset; character height at 1080p, scaled with the screen. */
  sizePreset: CubSizePreset;
  /** Custom character height in px at 1080p (used when sizePreset is "custom"). */
  size: number;
  position: CubPosition;
  /** Custom home: horizontal centre and floor line, in % of the screen. */
  homeX: number;
  homeY: number;
  intensity: CubIntensity;
  volume: number;
  performance: CubPerformance;
  reducedMotion: CubReducedMotion;
}

export const CUB_SCREENS: CubScreen[] = ["daily", "weekly", "monthly", "teams", "spin"];
export const CUB_DIALOGUES: CubDialogue[] = ["intro", "hungry", "angry", "sad", "feeding", "bonus"];

export const DEFAULT_CUB: ArenaCubConfig = {
  allowOnLiveArena: false,
  enabled: true,
  screens: { daily: true, weekly: true, monthly: true, teams: true, spin: false },
  intro: true,
  feeding: true,
  bonus: true,
  hunger: true,
  angry: true,
  sad: true,
  speech: true,
  sounds: false,
  particles: true,
  dialogue: { intro: true, hungry: true, angry: true, sad: true, feeding: true, bonus: true },
  hungerMin: 15,
  angryMin: 30,
  sadMin: 45,
  reminderEveryMin: 15,
  reminderCooldownMin: 5,
  introFrequency: "daily",
  bubbleSec: 6,
  feedingSec: 5,
  bonusSec: 6,
  activeStart: "09:00",
  activeEnd: "21:00",
  activeDays: [1, 2, 3, 4, 5, 6],
  sizePreset: "large",
  size: 300,
  position: "bottom-right",
  homeX: 80,
  homeY: 100,
  intensity: "standard",
  volume: 0.5,
  performance: "auto",
  reducedMotion: "system",
};

export class CubConfigError extends Error {}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function bool(o: Record<string, unknown>, k: string, d: boolean): boolean {
  const v = o[k];
  if (v === undefined) return d;
  if (typeof v !== "boolean") throw new CubConfigError(`${k} must be on or off`);
  return v;
}
function num(o: Record<string, unknown>, k: string, d: number, min: number, max: number, int = true): number {
  const v = o[k];
  if (v === undefined) return d;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new CubConfigError(`${k} must be between ${min} and ${max}`);
  return int ? Math.round(v) : v;
}
function pick<T extends string>(o: Record<string, unknown>, k: string, d: T, opts: readonly T[]): T {
  const v = o[k];
  if (v === undefined) return d;
  if (typeof v !== "string" || !opts.includes(v as T)) throw new CubConfigError(`${k} must be one of: ${opts.join(", ")}`);
  return v as T;
}
function flagSet<K extends string>(o: Record<string, unknown>, k: string, d: Record<K, boolean>, keys: readonly K[]): Record<K, boolean> {
  const v = o[k];
  if (v === undefined) return { ...d };
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new CubConfigError(`${k} must be a set of switches`);
  const out = { ...d };
  for (const key of keys) {
    const x = (v as Record<string, unknown>)[key];
    if (x === undefined) continue;
    if (typeof x !== "boolean") throw new CubConfigError(`${k}.${key} must be on or off`);
    out[key] = x;
  }
  return out;
}

/**
 * Validates a full or partial Arena Cub config on top of `base` (unknown keys are refused) and
 * checks the timing rules: hungry < angry < sad, valid active hours.
 */
export function validateCub(input: unknown, base: ArenaCubConfig = DEFAULT_CUB, opts: { crossChecks?: boolean } = {}): ArenaCubConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CubConfigError("must be a set of Arena Cub settings");
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(k in DEFAULT_CUB)) throw new CubConfigError(`"${k}" is not an Arena Cub setting`);
  const b = { ...DEFAULT_CUB, ...base };
  const out: ArenaCubConfig = {
    allowOnLiveArena: bool(o, "allowOnLiveArena", b.allowOnLiveArena),
    enabled: bool(o, "enabled", b.enabled),
    screens: flagSet(o, "screens", b.screens, CUB_SCREENS),
    intro: bool(o, "intro", b.intro),
    feeding: bool(o, "feeding", b.feeding),
    bonus: bool(o, "bonus", b.bonus),
    hunger: bool(o, "hunger", b.hunger),
    angry: bool(o, "angry", b.angry),
    sad: bool(o, "sad", b.sad),
    speech: bool(o, "speech", b.speech),
    sounds: bool(o, "sounds", b.sounds),
    particles: bool(o, "particles", b.particles),
    dialogue: flagSet(o, "dialogue", b.dialogue, CUB_DIALOGUES),
    hungerMin: num(o, "hungerMin", b.hungerMin, 1, 240),
    angryMin: num(o, "angryMin", b.angryMin, 2, 480),
    sadMin: num(o, "sadMin", b.sadMin, 3, 720),
    reminderEveryMin: num(o, "reminderEveryMin", b.reminderEveryMin, 5, 240),
    reminderCooldownMin: num(o, "reminderCooldownMin", b.reminderCooldownMin, 0, 120),
    introFrequency: pick(o, "introFrequency", b.introFrequency, ["every_load", "hourly", "daily", "off"] as const),
    bubbleSec: num(o, "bubbleSec", b.bubbleSec, 2, 20),
    feedingSec: num(o, "feedingSec", b.feedingSec, 3, 12),
    bonusSec: num(o, "bonusSec", b.bonusSec, 3, 15),
    activeStart: b.activeStart,
    activeEnd: b.activeEnd,
    activeDays: [...b.activeDays],
    sizePreset: pick(o, "sizePreset", b.sizePreset, ["small", "medium", "large", "xl", "custom"] as const),
    size: num(o, "size", b.size, 90, 450),
    position: pick(o, "position", b.position, ["auto", "bottom-right", "bottom-left", "bottom-center", "custom"] as const),
    homeX: num(o, "homeX", b.homeX, 0, 100),
    homeY: num(o, "homeY", b.homeY, 20, 100),
    intensity: pick(o, "intensity", b.intensity, ["calm", "standard", "lively"] as const),
    volume: num(o, "volume", b.volume, 0, 1, false),
    performance: pick(o, "performance", b.performance, ["auto", "full", "lite"] as const),
    reducedMotion: pick(o, "reducedMotion", b.reducedMotion, ["system", "always"] as const),
  };
  for (const k of ["activeStart", "activeEnd"] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== "string" || !TIME.test(o[k] as string)) throw new CubConfigError(`${k} must be a time such as 09:00`);
    out[k] = o[k] as string;
  }
  if (opts.crossChecks !== false && out.activeStart === out.activeEnd) throw new CubConfigError("active hours must start and end at different times");
  if (o.activeDays !== undefined) {
    const d = o.activeDays;
    if (!Array.isArray(d) || d.length > 7 || d.some((x) => !Number.isInteger(x) || (x as number) < 0 || (x as number) > 6))
      throw new CubConfigError("activeDays must list weekdays 0 (Sunday) to 6 (Saturday)");
    out.activeDays = [...new Set(d as number[])].sort();
  }
  if (opts.crossChecks !== false && !(out.hungerMin < out.angryMin && out.angryMin < out.sadMin))
    throw new CubConfigError("the hungry time must come before the playfully angry time, and that before the sad time");
  return out;
}

/**
 * Validates a PARTIAL change (only the keys the admin changed): every key is checked on its own; rules
 * that involve several keys (hungry < angry < sad, start ≠ end) are checked by the server on the merged
 * result. Sending only what changed means a stale browser copy can never overwrite other settings
 * (in particular the Live Arena permission).
 */
export function validateCubPatch(input: unknown): Partial<ArenaCubConfig> {
  const full = validateCub(input, DEFAULT_CUB, { crossChecks: false });
  const out: Partial<ArenaCubConfig> = {};
  for (const k of Object.keys(input as object) as Array<keyof ArenaCubConfig>) (out as Record<string, unknown>)[k] = full[k];
  return out;
}

/** Lenient read for stored or cached values: anything invalid falls back to the defaults. */
export function readCub(v: unknown): ArenaCubConfig {
  try {
    return validateCub(v ?? {}, DEFAULT_CUB);
  } catch {
    return { ...DEFAULT_CUB };
  }
}
