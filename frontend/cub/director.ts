import type { ArenaCubConfig, CubDialogue } from "@/shared/cub/config";
import { enqueue, interrupts, type CubAct, type CubMood, type CubPose } from "./machine";
import { bonusLines, feedingLines, phrase } from "./phrases";
import { CUB_ACTION_LINES, CUB_ACTION_SEC, GREETING, isMove, type CubAction, type CubUtility } from "@/shared/cub/actions";
import type { CubSound } from "@/frontend/audio/synth";

/**
 * Arena Cub director: plays one act at a time on top of the ambient mood, from a bounded priority
 * queue (genuine bonus > genuine sale > admin command > intro > reminder), with every timer owned
 * here (dispose() clears them all). No React, no DOM: unit-tested with fake timers.
 */

export interface CubView {
  pose: CubPose;
  act: "reminder" | null;
  /** Increments whenever an act starts (restarts its CSS animation). */
  playKey: number;
  bubble: { title: string; detail: string | null } | null;
  /** The admin action being performed (the player animates moves from it). */
  command: { id: string; action: CubAction } | null;
}

export interface DirectorDeps {
  now: () => number;
  render: (v: CubView) => void;
  sound?: (kind: CubSound) => void;
  /** Duration (s) of a move on this screen (depends on its width). */
  moveSec?: (action: CubAction, id: string) => number;
  /** Delivery evidence for admin commands: called when one really starts, finishes, or is cut short. */
  commandPhase?: (id: string, phase: "started" | "completed" | "interrupted") => void;
}

export const INTRO_SEC = 4.6;
/** Share of the intro after which the "Hey team!" bubble appears. */
const INTRO_BUBBLE_AT = 0.66;

const COMMAND_POSE: Record<CubAction, CubPose> = {
  wave: "wave",
  happy: "happy",
  hungry: "hungry",
  angry: "angry",
  sad: "sad",
  sleep: "sleeping",
  wake: "wake",
  run_left: "run",
  run_right: "run",
  run_across: "run",
  dash: "run",
  jump_run: "run",
  roam: "run",
  jump: "jump",
  dance: "dance",
  spin: "spin",
  backflip: "backflip",
  eat_token: "feeding",
  celebrate: "bonus",
  greet: "greet",
  peek: "peek",
  goodbye: "wave",
};
const COMMAND_SOUND: Partial<Record<CubAction, CubSound>> = {
  wave: "intro",
  greet: "intro",
  peek: "intro",
  goodbye: "intro",
  wake: "intro",
  happy: "bonus",
  dance: "bonus",
  backflip: "bonus",
  celebrate: "bonus",
  eat_token: "feeding",
  hungry: "hungry",
  angry: "angry",
  sad: "sad",
};

type Line = { at: number; sec: number; title: string; detail: string | null };

export class CubDirector {
  private cfg: ArenaCubConfig;
  private mood: CubMood = "idle";
  private playing: CubAct | null = null;
  private queue: CubAct[] = [];
  private actTimers = new Set<ReturnType<typeof setTimeout>>();
  private bubbleTimers = new Set<ReturnType<typeof setTimeout>>();
  private bubble: CubView["bubble"] = null;
  private key = 0;
  private blocked = false;
  private visible = true;
  private disposed = false;
  private lastActEnd = -Infinity;

  constructor(cfg: ArenaCubConfig, private readonly deps: DirectorDeps) {
    this.cfg = cfg;
  }

  // ------------------------------------------------------------ inputs

  setConfig(cfg: ArenaCubConfig) {
    // Same settings object again: nothing to do. (Emitting here would re-render the host, which could
    // call setConfig again — an endless render loop.)
    if (cfg === this.cfg) return;
    this.cfg = cfg;
    this.queue = this.queue.filter((a) => this.allowed(a));
    if (this.playing && !this.allowed(this.playing)) this.stopCurrent();
    this.emit();
    this.pump();
  }

  setMood(mood: CubMood) {
    if (mood === this.mood) return;
    this.mood = mood;
    if (!this.playing) this.emit();
  }

  /** Blocked while a bonus popup or the spin journey is on screen: nothing new starts. */
  setBlocked(blocked: boolean) {
    this.blocked = blocked;
    if (!blocked) this.pump();
  }

  /** Not shown (disabled, other screen, Live Arena permission off): pending acts are dropped, never replayed later. */
  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) {
      this.queue = [];
      this.stopCurrent();
      this.emit();
    }
  }

  push(act: CubAct): boolean {
    if (this.disposed || !this.visible || !this.allowed(act)) return false;
    if (act.kind === "reminder" && !this.canRemind()) return false;
    if (act.kind === "command" && act.expiresAt !== undefined && act.expiresAt < this.deps.now()) return false;
    this.queue = enqueue(this.queue, act);
    if (interrupts(this.playing, act)) this.stopCurrent();
    this.pump();
    return true;
  }

  /** Stop / Return Home / Reset: ends admin actions, intros and reminders. Genuine celebrations always finish. */
  utility(u: CubUtility) {
    this.queue = this.queue.filter((a) => a.kind !== "command" && (u !== "reset" || (a.kind !== "intro" && a.kind !== "reminder")));
    const p = this.playing;
    if (p && (p.kind === "command" || p.kind === "intro" || p.kind === "reminder")) {
      this.stopCurrent();
      this.lastActEnd = this.deps.now();
    }
    this.emit();
    this.pump();
  }

  /** A reminder only when nothing else is playing or waiting, and not within the cooldown. */
  canRemind(): boolean {
    return !this.playing && !this.queue.length && this.deps.now() - this.lastActEnd >= this.cfg.reminderCooldownMin * 60_000;
  }

  get state() {
    return { playing: this.playing, queue: [...this.queue], mood: this.mood, timers: this.actTimers.size + this.bubbleTimers.size };
  }

  dispose() {
    this.disposed = true;
    this.clear(this.actTimers);
    this.clear(this.bubbleTimers);
    this.queue = [];
    this.playing = null;
  }

  // ------------------------------------------------------------ internals

  private allowed(a: CubAct): boolean {
    const c = this.cfg;
    if (!c.enabled) return false;
    switch (a.kind) {
      case "intro":
        return c.intro;
      case "feeding":
        return c.feeding;
      case "bonus":
        return c.bonus;
      case "reminder":
        return c.hunger && (a.mood !== "angry" || c.angry) && (a.mood !== "sad" || c.sad);
      case "command":
        return true; // admin-triggered: the admin chose it
    }
  }

  private durationSec(a: CubAct): number {
    switch (a.kind) {
      case "intro":
        return INTRO_SEC;
      case "feeding":
        return this.cfg.feedingSec;
      case "bonus":
        return this.cfg.bonusSec;
      case "reminder":
        return Math.max(4, this.cfg.bubbleSec);
      case "command":
        if (isMove(a.action)) return this.deps.moveSec?.(a.action, a.id) ?? 6;
        if (a.action === "eat_token") return this.cfg.feedingSec;
        if (a.action === "celebrate") return this.cfg.bonusSec;
        return CUB_ACTION_SEC[a.action as keyof typeof CUB_ACTION_SEC];
    }
  }

  /** Speech for an act. Admin actions never claim that a sale or award happened. */
  private lines(a: CubAct): { lines: Line[]; cat: CubDialogue | null } {
    const one = (title: string, detail: string | null, at: number): Line[] => [{ at, sec: this.cfg.bubbleSec, title, detail }];
    switch (a.kind) {
      case "intro":
        return { lines: one(phrase("intro"), null, INTRO_SEC * INTRO_BUBBLE_AT), cat: "intro" };
      case "feeding": {
        const l = feedingLines(a.sales);
        return { lines: one(l.title, l.detail, Math.min(this.cfg.feedingSec * 0.3, 1.5)), cat: "feeding" };
      }
      case "bonus": {
        const l = bonusLines(a.awards);
        return { lines: one(l.title, l.detail, 0.2), cat: "bonus" };
      }
      case "reminder":
        return { lines: one(phrase(a.mood, a.key), null, 0.2), cat: a.mood };
      case "command": {
        if (a.action === "greet") return { lines: GREETING.map((g) => ({ ...g, detail: null })), cat: null };
        if (a.action === "hungry" || a.action === "angry" || a.action === "sad") return { lines: one(phrase(a.action, a.id), null, 0.3), cat: null };
        const t = CUB_ACTION_LINES[a.action];
        return { lines: t ? one(t, null, a.action === "eat_token" ? 1.5 : 0.3) : [], cat: null };
      }
    }
  }

  private pump() {
    if (this.disposed || this.playing || this.blocked || !this.visible) return;
    while (this.queue.length) {
      const next = this.queue.shift()!;
      // An admin command that waited past its expiry is dropped (never played late).
      if (next.kind === "command" && next.expiresAt !== undefined && next.expiresAt < this.deps.now()) continue;
      this.start(next);
      return;
    }
  }

  private start(a: CubAct) {
    this.playing = a;
    this.key += 1;
    this.clear(this.bubbleTimers);
    this.bubble = null;
    const dur = this.durationSec(a);
    const { lines, cat } = this.lines(a);
    if (this.cfg.speech && (cat === null || this.cfg.dialogue[cat])) {
      for (const l of lines)
        this.later(this.bubbleTimers, l.at, () => {
          this.bubble = { title: l.title, detail: l.detail };
          this.emit();
          this.later(this.bubbleTimers, l.sec, () => {
            if (this.bubble?.title !== l.title) return; // a later line already replaced it
            this.bubble = null;
            this.emit();
          });
        });
    }
    const sound: CubSound | undefined = a.kind === "command" ? COMMAND_SOUND[a.action] : a.kind === "reminder" ? a.mood : a.kind;
    if (sound) this.deps.sound?.(sound);
    if (a.kind === "command") this.deps.commandPhase?.(a.id, "started");
    this.emit();
    this.later(this.actTimers, dur, () => this.finish());
  }

  private finish() {
    const wasCommand = this.playing?.kind === "command";
    if (this.playing?.kind === "command") this.deps.commandPhase?.(this.playing.id, "completed");
    this.playing = null;
    this.lastActEnd = this.deps.now();
    // Admin actions leave no speech behind once they finish.
    if (wasCommand) {
      this.clear(this.bubbleTimers);
      this.bubble = null;
    }
    this.emit();
    this.pump();
  }

  private stopCurrent() {
    if (this.playing?.kind === "command" && !this.disposed) this.deps.commandPhase?.(this.playing.id, "interrupted");
    this.clear(this.actTimers);
    this.clear(this.bubbleTimers);
    this.bubble = null;
    this.playing = null;
  }

  private later(set: Set<ReturnType<typeof setTimeout>>, sec: number, fn: () => void) {
    const t = setTimeout(() => {
      set.delete(t);
      if (!this.disposed) fn();
    }, sec * 1000);
    set.add(t);
  }

  private clear(set: Set<ReturnType<typeof setTimeout>>) {
    set.forEach((t) => clearTimeout(t));
    set.clear();
  }

  view(): CubView {
    const p = this.playing;
    let pose: CubPose = this.mood;
    let act: CubView["act"] = null;
    if (p?.kind === "reminder") {
      pose = p.mood;
      act = "reminder";
    } else if (p?.kind === "command") {
      pose = COMMAND_POSE[p.action];
      if (p.action === "hungry" || p.action === "angry" || p.action === "sad") act = "reminder";
    } else if (p) pose = p.kind;
    return { pose, act, playKey: this.key, bubble: this.bubble, command: p?.kind === "command" ? { id: p.id, action: p.action } : null };
  }

  private emit() {
    if (!this.disposed) this.deps.render(this.view());
  }
}
