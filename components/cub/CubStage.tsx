"use client";

import { useMemo } from "react";
import "./arena-cub.css";
import { CubCharacter, CUB_ASPECT } from "./CubCharacter";
import type { CubPose } from "@/lib/cub/machine";

export type CubMotion = "full" | "lite" | "reduced";
export interface CubBubble {
  title: string;
  detail?: string | null;
  side: "left" | "right" | "top";
  compact?: boolean;
}

export interface CubStageProps {
  pose: CubPose;
  /** "reminder" while a reminder performance plays on top of a mood. */
  act?: "reminder" | null;
  /** Changes whenever an act (re)starts, so its CSS animation restarts from 0. */
  playKey?: string | number;
  size: number;
  motion: CubMotion;
  paused?: boolean;
  amp?: number;
  durations?: { intro?: number; feed?: number; bonus?: number; act?: number };
  bubble?: CubBubble | null;
  particles?: boolean;
  logo?: string;
  testId?: string;
  /** Movement phase while running (prep, run, turn, settle) and facing direction. */
  move?: "prep" | "run" | "turn" | "settle" | null;
  dir?: -1 | 1;
  /** Length of one run cycle (s): shorter = faster legs. */
  cycle?: number;
  hops?: boolean;
  /** Speech-bubble text scale (follows the cub's size). */
  bubbleScale?: number;
}

const CONFETTI = ["#A78BFA", "#22D3EE", "#FDE047", "#F472B6", "#34D399", "#FB923C"];

/** Burst layout is fixed (no Math.random in render): pleasant, cheap and identical on every screen. */
function burst(kind: "feeding" | "bonus") {
  const n = kind === "bonus" ? 14 : 10;
  const out: Array<{ dx: number; dy: number; s: number; d: number; delay: number; c?: string; r?: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (kind === "bonus" ? 0.2 : 0);
    const dist = (kind === "bonus" ? 95 : 70) + ((i * 37) % 30);
    out.push({ dx: Math.cos(a) * dist, dy: Math.sin(a) * dist * 0.8 - 18, s: 5 + ((i * 7) % 5), d: 1.1 + ((i * 13) % 6) / 10, delay: 0 });
  }
  if (kind === "bonus")
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + ((i / 15) - 0.5) * 2.4;
      out.push({ dx: Math.cos(a) * (80 + (i % 4) * 22), dy: Math.sin(a) * (110 + (i % 3) * 20), s: 0, d: 1.8 + (i % 5) / 10, delay: 0.05 * (i % 4), c: CONFETTI[i % CONFETTI.length], r: 360 + (i % 3) * 180 });
    }
  return out;
}

export function CubStage({ pose, act = null, playKey, size, motion, paused = false, amp = 1, durations = {}, bubble, particles = true, logo, testId = "arena-cub", move = null, dir = 1, cycle = 0.42, hops = false, bubbleScale = 1 }: CubStageProps) {
  const fx = useMemo(() => (pose === "feeding" || pose === "bonus" ? burst(pose) : null), [pose]);
  const fxDelay = pose === "feeding" ? (durations.feed ?? 5) * 0.6 : (durations.bonus ?? 6) * 0.12;
  const style = {
    width: size,
    height: Math.round(size * CUB_ASPECT),
    "--cub-intro": `${durations.intro ?? 4.6}s`,
    "--cub-feed": `${durations.feed ?? 5}s`,
    "--cub-bonus": `${durations.bonus ?? 6}s`,
    "--cub-act": `${durations.act ?? 6}s`,
    "--cub-amp": amp,
    "--dir": dir,
    "--cycle": `${cycle}s`,
    "--cub-bscale": bubbleScale,
  } as React.CSSProperties;

  return (
    <div className="cub" data-testid={testId} data-pose={pose} data-act={act ?? undefined} data-motion={motion} data-paused={paused ? "true" : undefined} data-move={move ?? undefined} data-dir={dir} data-hops={hops ? "true" : undefined} style={style} key={playKey}>
      <CubCharacter logo={logo} />
      {fx && particles && motion !== "reduced" && (
        <div className="cub-fx" aria-hidden="true">
          {fx.map((p, i) => (
            <i
              key={i}
              className={p.c ? "c" : undefined}
              style={{ "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--s": `${p.s}px`, "--d": `${p.d}s`, "--delay": `${fxDelay + p.delay}s`, "--c": p.c, "--r": `${p.r ?? 0}deg` } as React.CSSProperties}
            />
          ))}
        </div>
      )}
      {bubble && (
        <div
          style={{
            position: "absolute",
            zIndex: 2,
            ...(bubble.side === "left"
              ? { right: "84%", bottom: "46%" }
              : bubble.side === "right"
                ? { left: "84%", bottom: "46%" }
                : { left: "50%", bottom: "94%", transform: "translateX(-50%)" }),
          }}
        >
          <div
            className="cub-bubble"
            role="status"
            data-testid={`${testId}-bubble`}
            data-side={bubble.side}
            data-compact={bubble.compact ? "true" : "false"}
            style={{ position: "relative", width: "max-content" }}
          >
            <b>{bubble.title}</b>
            {bubble.detail && <span>{bubble.detail}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
