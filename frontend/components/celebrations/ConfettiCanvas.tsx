"use client";

import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { QUALITY_PRESETS } from "@/frontend/performance/quality";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  shape: "rect" | "circle";
}

const COLORS = ["#7568FF", "#27D5FF", "#36E0B5", "#FFC857", "#FF647C", "#FFFFFF"];
/** Golden confetti for the Weekly Top Performer ceremony. */
const GOLD = ["#FFD978", "#F5C451", "#E9B04A", "#FFF1C4", "#C98A2E", "#FFFFFF"];

export function ConfettiCanvas({
  active,
  tier = "standard",
}: {
  active: boolean;
  tier?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const settings = useSettingsStore();

  useEffect(() => {
    if (!active || !settings.particles) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    const isHighTier = tier === "team-target" || tier === "top-performer" || tier === "special" || tier === "weekly-top";
    const palette = tier === "weekly-top" ? GOLD : COLORS;
    // Particle budget follows the display's quality (full count at High / Ultra; fewer on Performance / Lite).
    const q = settings.quality === "auto" ? settings.autoQuality : settings.quality;
    const budget = Math.min(1, Math.max(0.2, QUALITY_PRESETS[q as keyof typeof QUALITY_PRESETS]?.particles ?? 1));
    const count = Math.round((isHighTier ? 120 : 60) * (budget >= 0.8 ? 1 : budget * 1.5));
    const particles: Particle[] = [];

    for (let i = 0; i < count; i++) {
      particles.push({
        x: width / 2 + (Math.random() - 0.5) * 400,
        y: height * 0.35 + (Math.random() - 0.5) * 100,
        vx: (Math.random() - 0.5) * 16,
        vy: -Math.random() * 14 - 4,
        size: Math.random() * 8 + 4,
        color: palette[Math.floor(Math.random() * palette.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        opacity: 1,
        shape: Math.random() > 0.4 ? "rect" : "circle",
      });
    }

    let animId: number;
    let elapsed = 0;
    let last = 0;

    const render = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      // Time-based: k = frames' worth of motion since the last frame (1 at 60 fps). A slow PC drops frames but
      // the confetti keeps its real speed and duration instead of crawling in slow motion.
      const k = last ? Math.min(4, (now - last) / 16.667) : 1;
      last = now;
      elapsed += 16 * k;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.vy += 0.35 * k; // gravity
        p.vx *= Math.pow(0.98, k); // drag
        p.rotation += p.rotationSpeed * k;
        if (elapsed > 1800) {
          p.opacity -= 0.02 * k;
        }

        if (p.opacity > 0) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = Math.max(0, p.opacity);
          ctx.fillStyle = p.color;

          if (p.shape === "circle") {
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          }
          ctx.restore();
        }
      }

      if (particles.some((p) => p.opacity > 0)) {
        animId = requestAnimationFrame(render);
      }
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the budget is read once per burst (a quality change mid-burst does not restart it)
  }, [active, tier, settings.particles]);

  if (!active || !settings.particles) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
    />
  );
}
