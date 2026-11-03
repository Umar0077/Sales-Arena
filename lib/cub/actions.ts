/**
 * Arena Cub actions: the ONLY animations an admin can trigger (preview or live). A fixed allowlist:
 * a command carries an action name from this list, never code, CSS or markup. Shared by the server
 * validator, the director and the Admin UI. No "use client".
 */

export const CUB_EMOTIONS = ["wave", "happy", "hungry", "angry", "sad", "sleep", "wake"] as const;
export const CUB_MOVES = ["run_left", "run_right", "run_across", "dash", "jump_run", "roam"] as const;
export const CUB_TRICKS = ["jump", "dance", "spin", "backflip", "eat_token", "celebrate", "greet", "peek", "goodbye"] as const;
/** Utility commands act on the director (no animation of their own). */
export const CUB_UTILITIES = ["home", "reset", "stop"] as const;

export type CubMoveAction = (typeof CUB_MOVES)[number];
export type CubAction = (typeof CUB_EMOTIONS)[number] | CubMoveAction | (typeof CUB_TRICKS)[number];
export type CubUtility = (typeof CUB_UTILITIES)[number];
export type CubCommandName = CubAction | CubUtility;

export const CUB_ACTIONS: readonly CubAction[] = [...CUB_EMOTIONS, ...CUB_MOVES, ...CUB_TRICKS];
export const CUB_COMMANDS: readonly CubCommandName[] = [...CUB_ACTIONS, ...CUB_UTILITIES];

export const isCubAction = (v: unknown): v is CubAction => typeof v === "string" && (CUB_ACTIONS as readonly string[]).includes(v);
export const isCubCommand = (v: unknown): v is CubCommandName => typeof v === "string" && (CUB_COMMANDS as readonly string[]).includes(v);
export const isMove = (a: string): a is CubMoveAction => (CUB_MOVES as readonly string[]).includes(a);

export const CUB_ACTION_LABEL: Record<CubCommandName, string> = {
  wave: "Wave / Say Hello",
  happy: "Happy",
  hungry: "Hungry",
  angry: "Angry",
  sad: "Sad / Crying",
  sleep: "Sleep",
  wake: "Wake Up",
  run_left: "Run Left",
  run_right: "Run Right",
  run_across: "Run Across Screen",
  dash: "Quick Dash",
  jump_run: "Playful Jump Run",
  roam: "Random Playful Run",
  jump: "Jump",
  dance: "Dance",
  spin: "Spin Around",
  backflip: "Playful Backflip",
  eat_token: "Eat Golden Sales Token",
  celebrate: "Celebrate",
  greet: "Greet & Introduce",
  peek: "Peek from the Edge",
  goodbye: "Wave Goodbye",
  home: "Return Home",
  reset: "Reset Mascot",
  stop: "Stop Current Animation",
};

/** Fixed durations (s). Moves are computed from the screen width (see lib/cub/motion.ts). */
export const CUB_ACTION_SEC: Record<Exclude<CubAction, CubMoveAction>, number> = {
  wave: 3.5,
  happy: 3.2,
  hungry: 5,
  angry: 5,
  sad: 5,
  sleep: 10,
  wake: 3.4,
  jump: 1.7,
  dance: 4.2,
  spin: 1.6,
  backflip: 1.9,
  eat_token: 5,
  celebrate: 6,
  greet: 13,
  peek: 4.2,
  goodbye: 3.5,
};

/** Speech for admin-triggered actions. Never claims a sale or award happened. */
export const CUB_ACTION_LINES: Partial<Record<CubAction, string>> = {
  wave: "Hello, team!",
  happy: "I'm so happy!",
  wake: "Good morning, team!",
  dance: "Dance break!",
  backflip: "Ta-da!",
  eat_token: "Yum! A golden token!",
  celebrate: "Let's celebrate, team!",
  peek: "Peekaboo!",
  goodbye: "Bye for now!",
};

/** The live greeting (≈13 s): three readable lines, then a happy jump. */
export const GREETING: Array<{ at: number; sec: number; title: string }> = [
  { at: 2.2, sec: 3.4, title: "Hey everyone! I'm Arena Cub, your FE Sales Arena mascot!" },
  { at: 5.8, sec: 3.6, title: "I get hungry when the Arena is quiet, and every genuine validated sale feeds me!" },
  { at: 9.6, sec: 3.1, title: "Let's keep the sales coming! ROAR!" },
];

export type CubTarget =
  | { scope: "all" }
  | { scope: "screen"; screen: "daily" | "weekly" | "monthly" }
  | { scope: "devices"; devices: string[] };

/** A live command as broadcast to displays (no admin identity: that is in the audit log). */
export interface CubCommand {
  id: string;
  action: CubCommandName;
  target: CubTarget;
  issuedAt: string;
  expiresAt: string;
}

/** Lifetime of a live command: a display that receives it later (or reconnects) ignores it. */
export const CUB_COMMAND_TTL_MS = 20_000;
