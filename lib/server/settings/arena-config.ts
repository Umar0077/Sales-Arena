import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { arenaBroadcaster, type ArenaBroadcastEventType } from "../events/broadcaster";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { CubConfigError, validateCub } from "@/lib/cub/config";

/**
 * Global FE Sales Arena configuration: ONE row in admin_settings, shared by every display and admin.
 * Browsers cache it (Zustand) but this row is the authority. Each save gets a new revision and is
 * broadcast on the shared SSE stream; displays re-fetch only when the revision is newer.
 *
 * Per-device conveniences (diagnostics overlay, TV mode, demo simulation) are NOT part of it.
 * Performance mode has its own row (settings/display.ts).
 */

const KEY = "arena.config";
const SCREEN_KEY = "arena.screen.current";

export type RewardKind = "daily" | "weekly" | "monthly";
export interface RewardCategory {
  /** Program Active: new awards in this category can be earned. */
  active: boolean;
  /** Show on Live Arena: popups and cards for this category appear publicly. */
  showOnArena: boolean;
}

type Validator = (v: unknown) => unknown; // returns the clean value or throws

class Bad extends Error {}
const bool: Validator = (v) => {
  if (typeof v !== "boolean") throw new Bad("must be on or off");
  return v;
};
const num = (min: number, max: number, int = false): Validator => (v) => {
  const n = Number(v);
  if (typeof v !== "number" || !Number.isFinite(n) || n < min || n > max) throw new Bad(`must be between ${min} and ${max}`);
  return int ? Math.round(n) : n;
};
const str = (max: number, allowEmpty = true): Validator => (v) => {
  if (typeof v !== "string" || v.length > max || (!allowEmpty && !v.trim())) throw new Bad(`must be text of at most ${max} characters`);
  return v;
};
const oneOf = (...opts: string[]): Validator => (v) => {
  if (typeof v !== "string" || !opts.includes(v)) throw new Bad(`must be one of: ${opts.join(", ")}`);
  return v;
};
const nullable = (inner: Validator): Validator => (v) => (v === null ? null : inner(v));
const flags = (keys: string[]): Validator => (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Bad("must be a set of switches");
  const out: Record<string, boolean> = {};
  for (const k of keys) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x !== "boolean") throw new Bad(`${k} must be on or off`);
    out[k] = x;
  }
  return out;
};
const timezone: Validator = (v) => {
  if (typeof v !== "string" || v.length > 64) throw new Bad("must be a timezone");
  if (v === "") return v;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
  } catch {
    throw new Bad("is not a known timezone");
  }
  return v;
};
const categories: Validator = (v) => {
  if (!v || typeof v !== "object") throw new Bad("must list daily, weekly and monthly");
  const out: Record<string, RewardCategory> = {};
  for (const k of ["daily", "weekly", "monthly"]) out[k] = flags(["active", "showOnArena"])((v as Record<string, unknown>)[k]) as unknown as RewardCategory;
  return out;
};
const logo: Validator = (v) => {
  if (v === null) return null;
  if (typeof v !== "string" || v.length > 400_000 || !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(v)) throw new Bad("must be a PNG, JPEG, WebP or SVG image under 300 KB");
  return v;
};

const SOUND_KEYS = Object.keys(DEFAULT_SETTINGS.soundCategories);

/** Every global setting, its validator and the event group it belongs to. */
const SCHEMA: Record<string, { v: Validator; group: ArenaBroadcastEventType }> = {
  // availability
  arenaEnabled: { v: bool, group: "arena.availability.updated" },
  arenaOfflineMessage: { v: str(200), group: "arena.availability.updated" },
  // screens
  arenaModes: { v: flags(["daily", "weekly", "monthly", "spin"]), group: "arena.screens.updated" },
  defaultArenaMode: { v: oneOf("daily", "weekly", "monthly", "spin"), group: "arena.screens.updated" },
  showModeSelector: { v: bool, group: "arena.screens.updated" },
  businessTimezone: { v: timezone, group: "arena.screens.updated" },
  weekStartDay: { v: num(0, 6, true), group: "arena.screens.updated" },
  currencyLabel: { v: str(6, false), group: "arena.screens.updated" },
  // reward categories & announcements
  rewardCategories: { v: categories, group: "rewards.program.visibility.updated" },
  announceCash: { v: bool, group: "rewards.program.visibility.updated" },
  announcePrizes: { v: bool, group: "rewards.program.visibility.updated" },
  announceAutoSpins: { v: bool, group: "rewards.program.visibility.updated" },
  announceManualSpins: { v: bool, group: "rewards.program.visibility.updated" },
  // celebrations
  celebrationPopups: { v: bool, group: "settings.celebration.updated" },
  intensity: { v: oneOf("calm", "standard", "epic"), group: "settings.celebration.updated" },
  particles: { v: bool, group: "settings.celebration.updated" },
  celebrationDuration: { v: num(2, 30), group: "settings.celebration.updated" },
  saleCelebrationStyle: { v: oneOf("toast", "banner", "off"), group: "settings.celebration.updated" },
  announceMilestones: { v: bool, group: "settings.celebration.updated" },
  announceTeamTargets: { v: bool, group: "settings.celebration.updated" },
  spinFeatureEnabled: { v: bool, group: "settings.celebration.updated" },
  spinFlowEnabled: { v: bool, group: "settings.celebration.updated" },
  spinPopupTimeoutSec: { v: num(0, 300, true), group: "settings.celebration.updated" },
  achievementHeadline: { v: str(120), group: "settings.celebration.updated" },
  achievementMessage: { v: str(160), group: "settings.celebration.updated" },
  achievementReward: { v: str(160), group: "settings.celebration.updated" },
  revealHeadline: { v: str(120), group: "settings.celebration.updated" },
  revealMessage: { v: str(160), group: "settings.celebration.updated" },
  revealStyle: { v: oneOf("cinematic", "minimal"), group: "settings.celebration.updated" },
  // sound
  soundEnabled: { v: bool, group: "settings.appearance.updated" },
  volume: { v: num(0, 1), group: "settings.appearance.updated" },
  soundCategories: { v: flags(SOUND_KEYS), group: "settings.appearance.updated" },
  // appearance
  motion: { v: oneOf("system", "full", "reduced"), group: "settings.appearance.updated" },
  accent: { v: oneOf("violet", "cyan", "emerald", "gold"), group: "settings.appearance.updated" },
  brandName: { v: str(40, false), group: "settings.appearance.updated" },
  brandTagline: { v: str(60), group: "settings.appearance.updated" },
  customLogo: { v: logo, group: "settings.appearance.updated" },
  backgroundEffects: { v: oneOf("full", "subtle", "off"), group: "settings.appearance.updated" },
  showKpis: { v: bool, group: "settings.appearance.updated" },
  showHero: { v: bool, group: "settings.appearance.updated" },
  showActivity: { v: bool, group: "settings.appearance.updated" },
  spinnerTheme: { v: oneOf("neon", "royal", "aurora", "sunset"), group: "settings.appearance.updated" },
  segmentColorMode: { v: oneOf("theme", "prize"), group: "settings.appearance.updated" },
  glowIntensity: { v: num(0, 1.5), group: "settings.appearance.updated" },
  spinnerLights: { v: bool, group: "settings.appearance.updated" },
  lightSpeed: { v: num(0.5, 2), group: "settings.appearance.updated" },
  spinDurationScale: { v: num(0.6, 1.6), group: "settings.appearance.updated" },
  spinnerFallback2D: { v: bool, group: "settings.appearance.updated" },
  // leaderboard
  leaderboardVisible: { v: bool, group: "settings.leaderboard.updated" },
  leaderboardCount: { v: num(3, 50, true), group: "settings.leaderboard.updated" },
  leaderboardCriteria: { v: oneOf("sales", "value"), group: "settings.leaderboard.updated" },
  leaderboardPeriod: { v: oneOf("daily", "weekly", "monthly"), group: "settings.leaderboard.updated" },
  leaderboardTeamId: { v: nullable(str(64)), group: "settings.leaderboard.updated" },
  leaderboardCampaignId: { v: nullable(str(64)), group: "settings.leaderboard.updated" },
  leaderboardAnimations: { v: bool, group: "settings.leaderboard.updated" },
  leaderboardSize: { v: oneOf("compact", "comfortable"), group: "settings.leaderboard.updated" },
  topPerformerStyle: { v: oneOf("podium", "highlight", "minimal"), group: "settings.leaderboard.updated" },
  // Arena Cub mascot (one validated object; timing rules are checked together)
  arenaCub: {
    v: (v) => {
      try {
        return validateCub(v);
      } catch (e) {
        throw new Bad(e instanceof CubConfigError ? e.message : "is invalid");
      }
    },
    group: "settings.mascot.updated",
  },
};

export const GLOBAL_SETTING_KEYS = Object.keys(SCHEMA);
export type ArenaConfigValues = Record<string, unknown>;

/** Defaults for a new installation (the same values a fresh browser had before). */
export function defaultConfig(): ArenaConfigValues {
  const d = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  const out: ArenaConfigValues = {};
  for (const k of GLOBAL_SETTING_KEYS) if (k in d) out[k] = d[k];
  return out;
}

export interface ArenaConfig {
  values: ArenaConfigValues;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}
export interface ScreenSwitch {
  screen: "daily" | "weekly" | "monthly" | "spin" | null;
  revision: number;
  at: string | null;
}

export class ConfigError extends Error {}

/** Validates a partial patch. Unknown keys are rejected (nothing is silently ignored). */
export function validatePatch(patch: unknown): ArenaConfigValues {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new ConfigError("Send the settings to change.");
  const out: ArenaConfigValues = {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const def = SCHEMA[k];
    if (!def) throw new ConfigError(`"${k}" is not a global setting.`);
    try {
      out[k] = def.v(v);
    } catch (e) {
      throw new ConfigError(`${k} ${e instanceof Bad ? e.message : "is invalid"}.`);
    }
  }
  if (!Object.keys(out).length) throw new ConfigError("Nothing to save.");
  return out;
}

export async function readArenaConfig(db: Pool | PoolClient): Promise<ArenaConfig> {
  const { rows } = await db.query(
    `SELECT s.value, u.email FROM admin_settings s LEFT JOIN admin_users u ON u.id::text = s.value->>'updatedBy' WHERE s.key = $1`,
    [KEY],
  );
  const v = rows[0]?.value as { values?: ArenaConfigValues; revision?: number; updatedAt?: string } | undefined;
  return {
    values: { ...defaultConfig(), ...(v?.values ?? {}) },
    revision: Number(v?.revision) || 0,
    updatedAt: v?.updatedAt ?? null,
    updatedBy: rows[0]?.email ?? null,
  };
}

export async function readScreenSwitch(db: Pool | PoolClient): Promise<ScreenSwitch> {
  const { rows } = await db.query(`SELECT value FROM admin_settings WHERE key = $1`, [SCREEN_KEY]);
  const v = rows[0]?.value as ScreenSwitch | undefined;
  return { screen: v?.screen ?? null, revision: Number(v?.revision) || 0, at: v?.at ?? null };
}

type Actor = { adminId: string; ip: string | null; userAgent: string | null };

async function inTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const auditable = (v: unknown) => (typeof v === "string" && v.length > 200 ? `${v.slice(0, 40)}… (${v.length} chars)` : v);

/** Saves a patch (row lock → merge → revision + 1 → audit → commit), then broadcasts the changed groups. */
export async function saveArenaConfig(pool: Pool, patch: unknown, actor: Actor): Promise<ArenaConfig> {
  const clean = validatePatch(patch);
  const groups = new Set<ArenaBroadcastEventType>();
  let revision = 0;
  await inTx(pool, async (c) => {
    await c.query(`INSERT INTO admin_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [KEY, JSON.stringify({ values: {}, revision: 0 })]);
    const cur = (await c.query(`SELECT value FROM admin_settings WHERE key = $1 FOR UPDATE`, [KEY])).rows[0].value as { values?: ArenaConfigValues; revision?: number };
    const before = { ...defaultConfig(), ...(cur.values ?? {}) };
    const merged = { ...before, ...clean };
    const modes = merged.arenaModes as Record<string, boolean>;
    if (clean.defaultArenaMode !== undefined && !modes[clean.defaultArenaMode as string])
      throw new ConfigError("The default screen must be one of the enabled screens.");
    // Disabling the current default moves the default to the first enabled screen.
    if (!modes[merged.defaultArenaMode as string]) merged.defaultArenaMode = ["daily", "weekly", "monthly", "spin"].find((m) => modes[m]) ?? merged.defaultArenaMode;
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(merged))
      if (JSON.stringify(before[k]) !== JSON.stringify(merged[k])) {
        changed[k] = { from: auditable(before[k]), to: auditable(merged[k]) };
        groups.add(SCHEMA[k]?.group ?? "arena.screens.updated");
      }
    revision = (Number(cur.revision) || 0) + 1;
    await c.query(`UPDATE admin_settings SET value = $2, updated_at = NOW() WHERE key = $1`, [
      KEY,
      JSON.stringify({ values: merged, revision, updatedAt: new Date().toISOString(), updatedBy: actor.adminId }),
    ]);
    await writeAudit(c, { adminId: actor.adminId, action: "settings.arena_config", targetType: "admin_setting", targetId: KEY, details: { revision, changed }, ip: actor.ip, userAgent: actor.userAgent });
  });
  for (const g of groups) arenaBroadcaster.broadcast(g, { revision, scope: "config" });
  return readArenaConfig(pool);
}

/** "Switch the Live Arena now": every connected display moves to this screen. */
export async function switchArenaScreen(pool: Pool, screen: unknown, actor: Actor): Promise<ScreenSwitch> {
  if (typeof screen !== "string" || !["daily", "weekly", "monthly", "spin"].includes(screen)) throw new ConfigError("Choose a screen.");
  const cfg = await readArenaConfig(pool);
  if (!(cfg.values.arenaModes as Record<string, boolean>)[screen]) throw new ConfigError("That screen is disabled. Enable it first.");
  const next = await inTx(pool, async (c) => {
    await c.query(`INSERT INTO admin_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [SCREEN_KEY, JSON.stringify({ screen: null, revision: 0 })]);
    const cur = (await c.query(`SELECT value FROM admin_settings WHERE key = $1 FOR UPDATE`, [SCREEN_KEY])).rows[0].value as ScreenSwitch;
    const v: ScreenSwitch = { screen: screen as ScreenSwitch["screen"], revision: (Number(cur.revision) || 0) + 1, at: new Date().toISOString() };
    await c.query(`UPDATE admin_settings SET value = $2, updated_at = NOW() WHERE key = $1`, [SCREEN_KEY, JSON.stringify({ ...v, by: actor.adminId })]);
    await writeAudit(c, { adminId: actor.adminId, action: "arena.screen_switched", targetType: "admin_setting", targetId: SCREEN_KEY, details: { from: cur.screen, to: screen, revision: v.revision }, ip: actor.ip, userAgent: actor.userAgent });
    return v;
  });
  arenaBroadcaster.broadcast("arena.screen.changed", { screen: next.screen, revision: next.revision });
  return next;
}

/** Business calendar used by the reward engine: admin setting first, then the server env. */
export function calendarFrom(values: ArenaConfigValues): { timezone: string; weekStartDay: number } {
  const tz = typeof values.businessTimezone === "string" && values.businessTimezone ? values.businessTimezone : process.env.SALES_ARENA_TIMEZONE || "America/New_York";
  const wd = Number(values.weekStartDay);
  return { timezone: tz, weekStartDay: Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : 1 };
}
