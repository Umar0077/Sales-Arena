/**
 * Arena Cub state machine (pure functions, no React, no timers): unit-tested in tests/unit/cub-machine.test.ts.
 *
 * Mood comes ONLY from the server's latest validated-sale time and the server clock, measured inside the
 * configured active sales hours (business timezone, never the viewer's). So every display shows the same
 * mood at the same moment and a refresh never restarts the count.
 */
import type { ArenaCubConfig } from "@/shared/cub/config";
import type { CubAction } from "@/shared/cub/actions";

export type CubMood = "idle" | "hungry" | "angry" | "sad" | "resting" | "sleeping";
export type ReminderMood = "hungry" | "angry" | "sad";

/** What the cub is performing right now. Ambient moods are the background; acts play on top. */
export type CubPose =
  | CubMood
  | "intro"
  | "feeding"
  | "bonus"
  // admin-triggered actions
  | "run"
  | "wave"
  | "happy"
  | "wake"
  | "jump"
  | "dance"
  | "spin"
  | "backflip"
  | "greet"
  | "peek";

export interface CubSale {
  caseId: string;
  agentName: string;
  validatedAt: string;
}
export interface CubAward {
  id: string;
  agentName: string;
  kind: "daily" | "weekly" | "monthly";
  rewardType?: string;
  amount: number;
  currency: string;
  prizeLabel?: string;
  upgrade?: boolean;
  previousAmount?: number;
  incrementAmount?: number;
}

export type CubAct =
  | { kind: "intro" }
  | { kind: "reminder"; mood: ReminderMood; key: string }
  | { kind: "feeding"; sales: CubSale[] }
  | { kind: "bonus"; awards: CubAward[] }
  /** Admin action (preview or live). expiresAt: local ms; a command that would start later is dropped. */
  | { kind: "command"; id: string; action: CubAction; expiresAt?: number };

/** Priority: genuine bonus > genuine sale > admin command > intro > reminder (disabled is handled by the controller). */
export const ACT_PRIORITY: Record<CubAct["kind"], number> = { bonus: 4, feeding: 3, command: 2, intro: 1, reminder: 0 };
export const MAX_QUEUE = 4;
/** Sales and awards kept per coalesced celebration (the count stays exact). */
export const MAX_ITEMS = 50;
/** A sale validated longer ago than this is history (e.g. found by a late reconciliation): no feeding. */
export const FRESH_SALE_MS = 30 * 60_000;
/** How long the brief sad performance lasts as ambient mood before the cub rests quietly. */
export const SAD_WINDOW_MIN = 2;
/** A reminder moment is only played while it is this fresh (a display opened later does not replay it). */
export const REMINDER_FRESH_MIN = 2;

// ---------------------------------------------------------------- business clock

export interface ZonedClock {
  dow: number;
  minutes: number;
  day: string;
}

/** Weekday, minutes since midnight and calendar day in the business timezone. */
export function zonedClock(now: Date, tz: string): ZonedClock {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const h = Number(get("hour")) % 24;
  return { dow, minutes: h * 60 + Number(get("minute")), day: `${get("year")}-${get("month")}-${get("day")}` };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether `now` is inside active sales hours, and when the current active window started. */
export function activeWindow(now: Date, cfg: Pick<ArenaCubConfig, "activeStart" | "activeEnd" | "activeDays">, tz: string): { active: boolean; startedAt: Date | null } {
  const c = zonedClock(now, tz);
  const start = toMin(cfg.activeStart);
  const end = toMin(cfg.activeEnd);
  const days = new Set(cfg.activeDays);
  const ago = (mins: number) => new Date(now.getTime() - mins * 60_000 - (now.getTime() % 60_000));
  if (start < end) {
    const on = days.has(c.dow) && c.minutes >= start && c.minutes < end;
    return { active: on, startedAt: on ? ago(c.minutes - start) : null };
  }
  // Overnight window, e.g. 20:00 → 04:00 (belongs to the day it started).
  if (c.minutes >= start && days.has(c.dow)) return { active: true, startedAt: ago(c.minutes - start) };
  if (c.minutes < end && days.has((c.dow + 6) % 7)) return { active: true, startedAt: ago(c.minutes + 24 * 60 - start) };
  return { active: false, startedAt: null };
}

// ---------------------------------------------------------------- ambient mood + reminders

export interface AmbientInput {
  now: Date;
  /** Latest validated sale (server). null = no sale known. */
  lastSaleAt: Date | null;
  /** False while live data is unavailable: the cub stays neutral instead of claiming "no sales". */
  dataOk: boolean;
  cfg: ArenaCubConfig;
  tz: string;
}
export interface Ambient {
  mood: CubMood;
  /** Quiet minutes counted inside active hours (0 when not applicable). */
  quietMin: number;
  /** The reminder due right now (fresh), if any. Its key is the same on every display. */
  reminder: { mood: ReminderMood; key: string } | null;
}

/** Reminder moments (minutes of quiet): hungry, angry, sad thresholds plus every `reminderEveryMin` after hungry. */
export function reminderMoments(cfg: ArenaCubConfig, upTo: number): number[] {
  const set = new Set<number>([cfg.hungerMin]);
  if (cfg.angry) set.add(cfg.angryMin);
  if (cfg.sad) set.add(cfg.sadMin);
  for (let t = cfg.hungerMin; t <= upTo; t += cfg.reminderEveryMin) set.add(t);
  return [...set].filter((t) => t <= upTo).sort((a, b) => a - b);
}

function reminderMoodAt(t: number, cfg: ArenaCubConfig): ReminderMood {
  if (t < cfg.angryMin) return "hungry";
  if (t < cfg.sadMin) return cfg.angry ? "angry" : "hungry";
  if (t === cfg.sadMin && cfg.sad) return "sad";
  return "hungry"; // later reminders stay gentle: no repeated crying
}

export function ambient({ now, lastSaleAt, dataOk, cfg, tz }: AmbientInput): Ambient {
  const win = activeWindow(now, cfg, tz);
  if (!win.active || !win.startedAt) return { mood: "sleeping", quietMin: 0, reminder: null };
  if (!dataOk) return { mood: "idle", quietMin: 0, reminder: null };
  const from = lastSaleAt && lastSaleAt > win.startedAt ? lastSaleAt : win.startedAt;
  const m = Math.max(0, (now.getTime() - from.getTime()) / 60_000);
  if (!cfg.hunger) return { mood: "idle", quietMin: m, reminder: null };

  let mood: CubMood;
  if (m < cfg.hungerMin) mood = "idle";
  else if (m < cfg.angryMin) mood = "hungry";
  else if (m < cfg.sadMin) mood = cfg.angry ? "angry" : "hungry";
  else if (m < cfg.sadMin + SAD_WINDOW_MIN && cfg.sad) mood = "sad";
  else mood = "resting";

  let reminder: Ambient["reminder"] = null;
  const moments = reminderMoments(cfg, m);
  const last = moments[moments.length - 1];
  if (last !== undefined && m - last < REMINDER_FRESH_MIN) reminder = { mood: reminderMoodAt(last, cfg), key: `${from.toISOString()}@${last}` };
  return { mood, quietMin: m, reminder };
}

// ---------------------------------------------------------------- celebration queue

/** Adds an act to the bounded queue: coalesces bursts, never drops a genuine sale from the count. */
export function enqueue(queue: CubAct[], act: CubAct): CubAct[] {
  const q = [...queue];
  if (act.kind === "feeding") {
    const i = q.findIndex((a) => a.kind === "feeding");
    if (i >= 0) {
      const cur = q[i] as Extract<CubAct, { kind: "feeding" }>;
      const seen = new Set(cur.sales.map((s) => s.caseId));
      q[i] = { kind: "feeding", sales: [...cur.sales, ...act.sales.filter((s) => !seen.has(s.caseId))].slice(-MAX_ITEMS) };
      return sortQueue(q);
    }
  } else if (act.kind === "bonus") {
    const i = q.findIndex((a) => a.kind === "bonus");
    if (i >= 0) {
      const cur = q[i] as Extract<CubAct, { kind: "bonus" }>;
      const seen = new Set(cur.awards.map((a) => a.id));
      q[i] = { kind: "bonus", awards: [...cur.awards, ...act.awards.filter((a) => !seen.has(a.id))].slice(-MAX_ITEMS) };
      return sortQueue(q);
    }
  } else if (act.kind === "command") {
    // Only the latest admin command waits; an older waiting one is replaced (never stacked).
    const i = q.findIndex((a) => a.kind === "command");
    if (i >= 0) {
      q[i] = act;
      return sortQueue(q);
    }
  } else if (act.kind === "intro") {
    if (q.some((a) => a.kind === "intro")) return q;
  } else if (act.kind === "reminder") {
    if (q.length) return q; // something better is already waiting: no reminder on top
  }
  q.push(act);
  // Bounded: lowest priority first to go.
  const sorted = sortQueue(q);
  return sorted.slice(0, MAX_QUEUE);
}

function sortQueue(q: CubAct[]): CubAct[] {
  return q.map((a, i) => ({ a, i })).sort((x, y) => ACT_PRIORITY[y.a.kind] - ACT_PRIORITY[x.a.kind] || x.i - y.i).map((x) => x.a);
}

/**
 * What may cut the current act short: a genuine sale or bonus stops an intro, reminder or admin action
 * (the cub runs home first); an admin action stops an intro, a reminder or an older admin action.
 * Genuine celebrations are never cut.
 */
export function interrupts(playing: CubAct | null, incoming: CubAct): boolean {
  if (!playing) return false;
  if (incoming.kind === "feeding" || incoming.kind === "bonus") return playing.kind === "intro" || playing.kind === "reminder" || playing.kind === "command";
  // A newer admin action replaces the one playing (the cub runs home first if it was moving).
  if (incoming.kind === "command") return playing.kind === "intro" || playing.kind === "reminder" || playing.kind === "command";
  return false;
}

/** Only a live, recent, genuine sale feeds the cub (never a historical import or an old reconciliation find). */
export function isFreshSale(p: { source?: unknown; validatedAt?: unknown }, serverNow: number): boolean {
  if (p.source === "backfill") return false;
  const t = new Date(String(p.validatedAt ?? "")).getTime();
  if (!Number.isFinite(t)) return false;
  return serverNow - t <= FRESH_SALE_MS && t - serverNow <= 5 * 60_000;
}

// ---------------------------------------------------------------- dedupe + intro

/** Bounded memory of ids already celebrated (optionally persisted per display). */
export class RecentIds {
  private ids: string[] = [];
  constructor(private readonly max = 300, private readonly storageKey: string | null = null) {
    if (storageKey && typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) this.ids = (JSON.parse(raw) as string[]).slice(-max);
      } catch {
        /* storage unavailable: memory only */
      }
    }
  }
  has(id: string): boolean {
    return this.ids.includes(id);
  }
  /** Adds the id; returns false if it was already known. */
  add(id: string): boolean {
    if (!id || this.has(id)) return false;
    this.ids.push(id);
    if (this.ids.length > this.max) this.ids.splice(0, this.ids.length - this.max);
    if (this.storageKey && typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.ids));
      } catch {
        /* ignore */
      }
    }
    return true;
  }
  get size(): number {
    return this.ids.length;
  }
}

/** Intro frequency per display. `lastAt` = when this display last played it (ms), null = never. */
export function shouldPlayIntro(freq: ArenaCubConfig["introFrequency"], lastAt: number | null, now: Date, tz: string): boolean {
  if (freq === "off") return false;
  if (freq === "every_load" || lastAt === null) return true;
  if (freq === "hourly") return now.getTime() - lastAt >= 60 * 60_000;
  return zonedClock(new Date(lastAt), tz).day !== zonedClock(now, tz).day;
}

/** Whether the cub is shown on this screen at all. */
/**
 * Whether the cub is shown on this PUBLIC screen. Precedence: the Live Arena permission
 * (allowOnLiveArena === true) is required first, then the feature switch, then the screen switch.
 */
export function cubVisibleOn(cfg: ArenaCubConfig, screen: string, arenaEnabled: boolean): boolean {
  return cfg.allowOnLiveArena === true && arenaEnabled && cfg.enabled && Boolean(cfg.screens[screen as keyof ArenaCubConfig["screens"]]);
}
