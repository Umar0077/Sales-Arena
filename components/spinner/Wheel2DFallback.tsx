"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Reward } from "@/types";
import { type SpinPlan, rotationAt, speedAt, phaseAt, segmentSize, landedSegment, normalizeRotation, TAU } from "@/features/spins/wheel-math";
import { audioEngine } from "@/lib/audio/engine";
import { drawWheelFace, drawGlowMask } from "./wheel-face";
import type { WheelLook, WheelPhase } from "./Wheel3D";

interface Props {
  rewards: Reward[];
  look: WheelLook;
  activeSpinPlan: SpinPlan | null;
  currentRotationRef: React.MutableRefObject<number>;
  onSpinComplete: (landedIndex: number) => void;
  onPhaseChange?: (phase: string) => void;
  phase: WheelPhase;
  winnerIndex: number | null;
}

/** Canvas 2D version of the wheel for devices without WebGL. Same face artwork and timing. */
export function Wheel2DFallback({ rewards, look, activeSpinPlan, currentRotationRef, onSpinComplete, onPhaseChange, phase, winnerIndex }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spinStart = useRef<number | null>(null);
  const lastPhase = useRef("idle");
  const lastPin = useRef(-1);
  const cb = useRef({ onSpinComplete, onPhaseChange, phase, winnerIndex, look });
  useEffect(() => {
    cb.current = { onSpinComplete, onPhaseChange, phase, winnerIndex, look };
  });

  const n = rewards.length;
  const key = rewards.map((r) => `${r.id}:${r.title}:${r.icon}`).join("|") + look.colors.join(",") + look.fontVersion;
  const art = useMemo(() => {
    const face = document.createElement("canvas");
    const glow = document.createElement("canvas");
    drawWheelFace(face, { rewards, colors: look.colors, size: 1024 });
    drawGlowMask(glow, { rewards, colors: look.colors, size: 1024 });
    return { face, glow };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!activeSpinPlan) return;
    spinStart.current = performance.now();
    lastPhase.current = "spinning";
    lastPin.current = -1;
    audioEngine.startLoop();
    cb.current.onPhaseChange?.("spinning");
  }, [activeSpinPlan]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const segAngle = segmentSize(n);
    let raf = 0;

    const render = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const { look: lk, winnerIndex: win } = cb.current;
      const radius = Math.min(w, h * 0.92) * 0.42;
      const cx = w / 2;
      const cy = h * 0.47;
      const now = performance.now();
      let speedNorm = 0;

      if (activeSpinPlan && spinStart.current !== null) {
        const elapsed = (now - spinStart.current) / 1000;
        currentRotationRef.current = rotationAt(activeSpinPlan, elapsed);
        speedNorm = Math.min(1, speedAt(activeSpinPlan, elapsed) / activeSpinPlan.peakSpeed);
        audioEngine.setLoopIntensity(speedNorm);
        const pin = Math.floor((((currentRotationRef.current % TAU) + TAU) % TAU) / segAngle);
        if (pin !== lastPin.current) {
          if (lastPin.current !== -1) audioEngine.play("tick", { rate: 0.8 + speedNorm * 0.6, volume: 0.25 + speedNorm * 0.5 });
          lastPin.current = pin;
        }
        const p = phaseAt(activeSpinPlan, elapsed);
        if (p !== lastPhase.current) {
          lastPhase.current = p;
          cb.current.onPhaseChange?.(p);
        }
        if (elapsed >= activeSpinPlan.duration) {
          audioEngine.stopLoop();
          spinStart.current = null;
          currentRotationRef.current = normalizeRotation(activeSpinPlan.endRotation);
          cb.current.onSpinComplete(landedSegment(currentRotationRef.current, n));
        }
      }

      ctx.clearRect(0, 0, w, h);

      // Halo
      const halo = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, radius * 1.5);
      halo.addColorStop(0, "rgba(139,92,255,0.35)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      // Chrome rim
      const rim = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
      rim.addColorStop(0, "#EEF2FA");
      rim.addColorStop(0.5, "#7C8598");
      rim.addColorStop(1, "#D9DFEA");
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.1, 0, TAU);
      ctx.fillStyle = rim;
      ctx.fill();

      // Rotating face (canvas rotates clockwise, wheel-math rotation is counter-clockwise)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-currentRotationRef.current);
      ctx.drawImage(art.face, -radius, -radius, radius * 2, radius * 2);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(1, lk.glow * (activeSpinPlan ? 0.6 + 0.4 * speedNorm : 0.7));
      ctx.drawImage(art.glow, -radius, -radius, radius * 2, radius * 2);
      ctx.restore();

      // Winner highlight: brighten the winning wedge
      if (win !== null) {
        const start = -Math.PI / 2 + win * segAngle - currentRotationRef.current;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, start, start + segAngle);
        ctx.closePath();
        ctx.fillStyle = `rgba(255,255,255,${0.12 + 0.08 * Math.sin(now / 160)})`;
        ctx.fill();
        ctx.restore();
      }

      // LED pegs
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * TAU;
        const b = lk.lights && !lk.reducedMotion ? 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(now / 420 - k * 0.55), 3) : 0.85;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * radius * 1.055, cy + Math.sin(a) * radius * 1.055, radius * 0.022, 0, TAU);
        ctx.fillStyle = lk.leds[k % 2];
        ctx.globalAlpha = b;
        ctx.shadowColor = lk.leds[k % 2];
        ctx.shadowBlur = 12 * b;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Teardrop pointer
      const py = cy - radius * 1.02;
      const pw = radius * 0.11;
      ctx.save();
      ctx.translate(cx, py);
      ctx.beginPath();
      ctx.moveTo(0, pw * 1.4);
      ctx.bezierCurveTo(pw * 0.5, pw * 0.6, pw, pw * 0.1, pw, -pw * 0.5);
      ctx.arc(0, -pw * 0.5, pw, 0, Math.PI, true);
      ctx.bezierCurveTo(-pw, pw * 0.1, -pw * 0.5, pw * 0.6, 0, pw * 1.4);
      ctx.fillStyle = "#E3E8F2";
      ctx.shadowColor = lk.accent;
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = lk.accent;
      ctx.stroke();
      ctx.restore();

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [activeSpinPlan, art, currentRotationRef, n]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Prize wheel" role="img" />;
}
