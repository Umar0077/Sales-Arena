"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, Component, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { Wheel3D, type WheelLook, type WheelPhase } from "./Wheel3D";
import { Wheel2DFallback } from "./Wheel2DFallback";
import { ensureSoraLoaded } from "./wheel-face";
import type { Reward } from "@/types";
import type { SpinPlan } from "@/features/spins/wheel-math";
import { usePerfStore } from "@/lib/performance/perf-store";
import { useSettingsStore } from "@/store/settings-store";
import { QUALITY_PRESETS } from "@/lib/performance/quality";
import { useReducedMotion } from "@/lib/performance/reduced-motion";
import { WHEEL_THEMES, segmentColors } from "@/features/spins/wheel-theme";
import { cn } from "@/lib/utils";

export interface WheelCanvasProps {
  rewards: Reward[];
  activeSpinPlan: SpinPlan | null;
  currentRotationRef: React.MutableRefObject<number>;
  onSpinComplete: (landedIndex: number) => void;
  onPhaseChange?: (phase: string) => void;
  phase: WheelPhase;
  winnerIndex: number | null;
  className?: string;
  /** Id for the diagnostics panel. */
  canvasId?: string;
}

class WebGLErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn("[WebGL] Canvas failed, switching to 2D fallback:", error);
  }
  override render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

let webGLSupport: boolean | null = null;
function detectWebGL(): boolean {
  if (webGLSupport === null) {
    try {
      const canvas = document.createElement("canvas");
      webGLSupport = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      webGLSupport = false;
    }
  }
  return webGLSupport;
}
const noopSubscribe = () => () => {};

/** Visual settings for the wheel, derived from admin settings. */
export function useWheelLook(rewards: Reward[]): WheelLook {
  const theme = useSettingsStore((s) => s.spinnerTheme);
  const mode = useSettingsStore((s) => s.segmentColorMode);
  const glow = useSettingsStore((s) => s.glowIntensity);
  const lights = useSettingsStore((s) => s.spinnerLights);
  const lightSpeed = useSettingsStore((s) => s.lightSpeed);
  const reducedMotion = useReducedMotion();
  const [fontVersion, setFontVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    ensureSoraLoaded().then(() => alive && setFontVersion(1));
    return () => {
      alive = false;
    };
  }, []);

  const colorsKey = rewards.map((r) => r.color).join(",");
  const colors = useMemo(
    () => segmentColors(rewards, theme, mode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colorsKey, rewards.length, theme, mode],
  );
  const t = WHEEL_THEMES[theme] ?? WHEEL_THEMES.neon;
  return useMemo(
    () => ({ colors, leds: t.leds, accent: t.accent, glow, lights, lightSpeed, reducedMotion, fontVersion }),
    [colors, t, glow, lights, lightSpeed, reducedMotion, fontVersion],
  );
}

export function WheelCanvas({
  rewards,
  activeSpinPlan,
  currentRotationRef,
  onSpinComplete,
  onPhaseChange,
  phase,
  winnerIndex,
  className,
  canvasId = "spinner-3d-main",
}: WheelCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const registerCanvas = usePerfStore((s) => s.register);
  const unregisterCanvas = usePerfStore((s) => s.unregister);
  const quality = useSettingsStore((s) => s.quality);
  const autoQuality = useSettingsStore((s) => s.autoQuality);
  const look = useWheelLook(rewards);

  // null on the server and during hydration, so both render the same placeholder.
  const hasWebGL = useSyncExternalStore(noopSubscribe, detectWebGL, () => null);
  const q = QUALITY_PRESETS[quality === "auto" ? autoQuality : quality] ?? QUALITY_PRESETS.high;

  useEffect(() => {
    registerCanvas({
      id: canvasId,
      label: "3D Spin Wheel",
      width: containerRef.current?.clientWidth || 600,
      height: containerRef.current?.clientHeight || 600,
      dpr: window.devicePixelRatio || 1,
      drawCalls: 28,
      triangles: 60000,
      geometries: 18,
      textures: 5,
    });
    return () => unregisterCanvas(canvasId);
  }, [registerCanvas, unregisterCanvas, canvasId]);

  const box = cn("relative w-full aspect-[1/1.08] max-h-[86vh] mx-auto select-none", className);

  const fallback = (
    <div className={box}>
      <Wheel2DFallback
        rewards={rewards}
        look={look}
        activeSpinPlan={activeSpinPlan}
        currentRotationRef={currentRotationRef}
        onSpinComplete={onSpinComplete}
        onPhaseChange={onPhaseChange}
        phase={phase}
        winnerIndex={winnerIndex}
      />
    </div>
  );

  const spinnerFallback2D = useSettingsStore((s) => s.spinnerFallback2D);
  const activeQuality = quality === "auto" ? autoQuality : quality;
  const isPerformance = activeQuality === "low" || activeQuality === "performance";

  const [tabVisible, setTabVisible] = useState(true);

  useEffect(() => {
    const handleVis = () => {
      setTabVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, []);

  if (hasWebGL === null) return <div className={box} />;
  if (hasWebGL === false || (spinnerFallback2D && isPerformance)) return fallback;

  // Demand-based rendering: pause completely when tab hidden, demand when idle, always when spinning/active
  const frameloop = !tabVisible
    ? "never"
    : phase === "spinning" || phase === "preparing" || (look.lights && !look.reducedMotion && q.ambientMotion)
    ? "always"
    : "demand";

  return (
    <div ref={containerRef} className={box} data-wheel="3d">
      <WebGLErrorBoundary fallback={fallback}>
        <Canvas
          // Cap resolution: in performance mode max 1.0; on high max 1.5 to save integrated GPU fill rate.
          dpr={[q.dpr[0], isPerformance ? 1.0 : Math.min(q.dpr[1], 1.5)]}
          gl={{
            antialias: q.antialias,
            powerPreference: isPerformance ? "default" : "high-performance",
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.1,
          }}
          camera={{ position: [0, 0.35, 11.7], fov: 40 }}
          onCreated={({ camera }) => camera.lookAt(0, -0.25, 0)}
          frameloop={frameloop}
        >
          <ambientLight intensity={0.35} />
          <spotLight position={[0, 7, 8]} angle={0.6} penumbra={0.7} intensity={60} color="#ffffff" />
          <pointLight position={[-6, -2, 4]} intensity={30} color="#FF3DB4" />
          <pointLight position={[6, -2, 4]} intensity={30} color="#22D3FF" />

          {/* Local reflection environment (no network): soft studio panels for the chrome. */}
          <Environment resolution={q.envResolution} frames={1}>
            <Lightformer form="rect" intensity={3} position={[0, 5, 5]} scale={[10, 2, 1]} color="#ffffff" />
            <Lightformer form="rect" intensity={2.2} position={[-6, 0, 3]} scale={[2, 8, 1]} color="#B58CFF" />
            <Lightformer form="rect" intensity={2.2} position={[6, 0, 3]} scale={[2, 8, 1]} color="#5FE6FF" />
            <Lightformer form="ring" intensity={1.5} position={[0, -4, 4]} scale={4} color="#FF66C4" />
          </Environment>

          <group position={[0, -0.05, 0]}>
            <Wheel3D
              rewards={rewards}
              look={look}
              activeSpinPlan={activeSpinPlan}
              currentRotationRef={currentRotationRef}
              onSpinComplete={onSpinComplete}
              onPhaseChange={onPhaseChange}
              phase={phase}
              winnerIndex={winnerIndex}
            />
          </group>
        </Canvas>
      </WebGLErrorBoundary>
    </div>
  );
}
