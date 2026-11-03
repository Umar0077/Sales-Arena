import type { ArenaCubConfig } from "./config";
import type { CubMoveAction } from "./actions";

/**
 * Arena Cub size, home position and movement paths. Pure functions: everything is computed from the
 * real bounds (viewport or the Admin preview stage), never from fixed coordinates. Unit-tested.
 */

/** Where the visible character sits inside the component box (the rest is headroom for jumps and the token). */
export const CHAR_BOX = { x0: 0.12, x1: 0.84, y0: 0.27, y1: 0.99 };
export const BOX_ASPECT = 310 / 280; // height / width of the SVG box

/** Character height at 1080p for each preset (scaled with the screen height). */
export const SIZE_PRESETS = { small: 170, medium: 240, large: 310, xl: 400 } as const;

export interface Bounds {
  w: number;
  h: number;
  /** Space reserved at the top (sticky header): the cub never goes above it. */
  top: number;
  /** The Go Connectivo badge, if shown: the bottom-right home stands beside it. */
  badge?: { x: number; y: number; w: number; h: number } | null;
}

/** Character height in px for these bounds (sharp vector art: any size renders crisply). */
export function charHeight(cfg: Pick<ArenaCubConfig, "sizePreset" | "size">, b: Pick<Bounds, "w" | "h">): number {
  const base = cfg.sizePreset === "custom" ? cfg.size : SIZE_PRESETS[cfg.sizePreset] ?? SIZE_PRESETS.large;
  const scale = Math.min(1.3, Math.max(0.5, b.h / 1080));
  // Never more than ~45% of the screen height or ~55% of a narrow screen's width.
  return Math.round(Math.max(70, Math.min(base * scale, b.h * 0.45, b.w * 0.55)));
}

export function boxFor(charH: number) {
  const h = charH / (CHAR_BOX.y1 - CHAR_BOX.y0);
  return { w: h / BOX_ASPECT, h };
}

export interface Home {
  left: number;
  top: number;
  boxW: number;
  boxH: number;
  charH: number;
}

/** Home position (top-left of the component box) inside the bounds; the character always stays fully visible. */
export function homeFor(cfg: Pick<ArenaCubConfig, "sizePreset" | "size" | "position" | "homeX" | "homeY">, b: Bounds): Home {
  const charH = charHeight(cfg, b);
  const box = boxFor(charH);
  const cw = box.w * (CHAR_BOX.x1 - CHAR_BOX.x0);
  const margin = Math.max(8, Math.round(b.w * 0.012));
  let charLeft: number;
  let charBottom = b.h - 6;
  switch (cfg.position) {
    case "bottom-left":
      charLeft = margin + 8;
      break;
    case "bottom-center":
      charLeft = b.w / 2 - cw / 2;
      break;
    case "custom":
      charLeft = (cfg.homeX / 100) * b.w - cw / 2;
      charBottom = (cfg.homeY / 100) * b.h - 6;
      break;
    default: {
      // bottom-right (and the legacy "auto"): beside the badge when it is there.
      const right = b.badge && b.badge.w > 0 ? b.badge.x - 14 : b.w - margin - 8;
      charLeft = right - cw;
    }
  }
  charLeft = Math.min(Math.max(charLeft, margin), b.w - margin - cw);
  charBottom = Math.min(Math.max(charBottom, b.top + charH + 4), b.h - 4);
  return { left: Math.round(charLeft - box.w * CHAR_BOX.x0), top: Math.round(charBottom - box.h * CHAR_BOX.y1), boxW: box.w, boxH: box.h, charH };
}

/** Bubble side with room for it (left, right, or above). */
export function bubbleSideFor(home: Home, b: Pick<Bounds, "w">, bubbleW: number): "left" | "right" | "top" {
  const charLeft = home.left + home.boxW * CHAR_BOX.x0;
  const charRight = home.left + home.boxW * CHAR_BOX.x1;
  if (charLeft - bubbleW - 8 >= 0) return "left";
  if (charRight + bubbleW + 8 <= b.w) return "right";
  return "top";
}

// ---------------------------------------------------------------- movement

export type MovePhase = "prep" | "run" | "turn" | "settle";
export interface MoveStep {
  phase: MovePhase;
  /** Duration of this step (ms). */
  ms: number;
  /** Horizontal offset from home at the END of this step (px). */
  x: number;
  /** Facing / lean direction during the step. */
  dir: -1 | 1;
  /** Little jumps while running (jump run). */
  hops?: boolean;
}
export interface MovePlan {
  action: CubMoveAction;
  steps: MoveStep[];
  totalMs: number;
}

/** Deterministic pick for "roam": every screen chooses the same pattern for the same command id. */
export function roamPick(id: string): Exclude<CubMoveAction, "roam"> {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (["run_left", "run_right", "run_across", "dash", "jump_run"] as const)[h % 5];
}

/** Plans a run that leaves home, turns around and comes back to exactly x = 0. Always inside the bounds. */
export function movePlan(action: CubMoveAction, home: Home, b: Pick<Bounds, "w">, id = ""): MovePlan {
  const a = action === "roam" ? roamPick(id) : action;
  const margin = 10;
  const charLeft = home.left + home.boxW * CHAR_BOX.x0;
  const charRight = home.left + home.boxW * CHAR_BOX.x1;
  const minX = Math.min(0, margin - charLeft); // furthest left offset (≤ 0)
  const maxX = Math.max(0, b.w - margin - charRight); // furthest right offset (≥ 0)
  let target: number;
  if (a === "run_left") target = minX;
  else if (a === "run_right") target = maxX;
  else {
    const wide = -minX > maxX ? minX : maxX; // across: towards the side with more room
    target = a === "dash" ? Math.sign(wide) * Math.min(Math.abs(wide), b.w * 0.3) : wide;
  }
  target = Math.round(target);
  const dir: -1 | 1 = target < 0 ? -1 : target > 0 ? 1 : a === "run_left" ? -1 : 1;
  const speed = (a === "dash" ? 1050 : 560) * Math.max(0.55, Math.min(1.2, b.w / 1920));
  const legMs = Math.max(a === "dash" ? 380 : 650, (Math.abs(target) / speed) * 1000);
  const hops = a === "jump_run";
  const steps: MoveStep[] = [
    { phase: "prep", ms: 450, x: 0, dir },
    { phase: "run", ms: Math.round(legMs), x: target, dir, hops },
    { phase: "turn", ms: 480, x: target, dir: dir === 1 ? -1 : 1 },
    { phase: "run", ms: Math.round(legMs), x: 0, dir: dir === 1 ? -1 : 1, hops },
    { phase: "settle", ms: 650, x: 0, dir },
  ];
  return { action: a, steps, totalMs: steps.reduce((n, s) => n + s.ms, 0) };
}
