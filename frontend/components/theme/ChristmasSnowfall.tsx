"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useArenaTheme } from "@/frontend/theme/arena-theme";
import { useLiteDisplay } from "@/frontend/performance/lite";
import { useReducedMotion } from "@/frontend/performance/reduced-motion";
import type { SnowfallIntensity } from "@/shared/types";

interface Flake {
  id: number;
  left: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  opacity: number;
  gold: boolean;
}

function buildFlakes(count: number): Flake[] {
  const flakes: Flake[] = [];
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random distribution so SSR and hydration match without layout shifts
    const left = ((i * 37 + 11) % 100) + ((i % 5) * 0.15);
    const size = 2.5 + ((i * 7) % 5) * 1.1;
    const duration = 11 + ((i * 13) % 11) * 1.1;
    const delay = -(((i * 17) % 20) * 0.75);
    const drift = ((i % 2 === 0 ? 1 : -1) * (10 + ((i * 11) % 22)));
    const opacity = 0.25 + ((i * 5) % 6) * 0.09;
    const gold = i % 7 === 0;
    flakes.push({ id: i, left, size, duration, delay, drift, opacity, gold });
  }
  return flakes;
}

/**
 * Lightweight, GPU-composited snowfall overlay for Christmas Edition.
 * - Renders ONLY when Christmas theme is active and snowfall is not "off".
 * - Respects Lite Mode (halves flake count) and prefers-reduced-motion (static winter stars).
 * - Pauses automatically when the browser tab is hidden.
 * - pointer-events: none so it never intercepts clicks or causes scrollbars.
 */
export function ChristmasSnowfall({
  intensityOverride,
  contained = false,
}: {
  intensityOverride?: SnowfallIntensity;
  /** True when rendered inside the Admin 16:9 TV Preview box (uses absolute inset-0 instead of fixed). */
  contained?: boolean;
} = {}) {
  const { isChristmas, snowfall: themeSnowfall } = useArenaTheme();
  const lite = useLiteDisplay();
  const reducedMotion = useReducedMotion();
  const [tabHidden, setTabHidden] = useState(false);

  const intensity = intensityOverride ?? themeSnowfall;
  const active = isChristmas && intensity !== "off";

  useEffect(() => {
    if (!active) return;
    const onVis = () => setTabHidden(document.visibilityState === "hidden");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [active]);

  const flakeCount = useMemo(() => {
    if (!active) return 0;
    if (reducedMotion) return 14;
    const base = intensity === "medium" ? 44 : 24;
    return lite ? Math.max(10, Math.round(base * 0.45)) : base;
  }, [active, intensity, lite, reducedMotion]);

  const flakes = useMemo(() => buildFlakes(flakeCount), [flakeCount]);

  if (!active || flakes.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="christmas-snowfall"
      data-snowfall-intensity={intensity}
      data-snowfall-motion={reducedMotion ? "static" : lite ? "lite" : "full"}
      data-snowfall-paused={tabHidden ? "true" : undefined}
      className={`xmas-snowfall pointer-events-none ${
        contained ? "absolute inset-0 z-20" : "fixed inset-0 z-30"
      } overflow-hidden`}
    >
      {flakes.map((f) => (
        <span
          key={f.id}
          className={`xmas-flake ${f.gold ? "xmas-flake--gold" : ""}`}
          style={
            {
              left: `${f.left.toFixed(2)}%`,
              width: `${f.size.toFixed(1)}px`,
              height: `${f.size.toFixed(1)}px`,
              opacity: f.opacity,
              "--flake-dur": `${f.duration.toFixed(1)}s`,
              "--flake-delay": `${f.delay.toFixed(2)}s`,
              "--flake-drift": `${f.drift}px`,
              top: reducedMotion ? `${((f.id * 29 + 7) % 88) + 4}%` : undefined,
              animationPlayState: tabHidden || reducedMotion ? "paused" : "running",
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
