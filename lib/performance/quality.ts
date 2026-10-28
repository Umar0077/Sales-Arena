import type { QualityPreset } from "@/types";

export interface QualityConfig {
  label: string;
  description: string;
  /** Device-pixel-ratio range for WebGL canvases [min, max]. */
  dpr: [number, number];
  antialias: boolean;
  /** Multiplier for particle counts (confetti, sparks). */
  particles: number;
  shadows: boolean;
  /** Speed-streak "motion blur" overlay on the wheel. */
  motionBlur: boolean;
  /** Environment cube-map resolution for metallic reflections. */
  envResolution: number;
  /** Radial segments for curved geometry. */
  curveSegments: number;
  ambientMotion: boolean;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityConfig> = {
  ultra: {
    label: "Ultra",
    description: "Full visual quality for capable desktop GPUs.",
    dpr: [1, 2],
    antialias: true,
    particles: 1,
    shadows: true,
    motionBlur: true,
    envResolution: 256,
    curveSegments: 48,
    ambientMotion: true,
  },
  high: {
    label: "High",
    description: "Premium quality with optimised effects.",
    dpr: [1, 1.75],
    antialias: true,
    particles: 0.8,
    shadows: true,
    motionBlur: true,
    envResolution: 128,
    curveSegments: 36,
    ambientMotion: true,
  },
  balanced: {
    label: "Balanced",
    description: "Reduced particles and simplified effects.",
    dpr: [1, 1.5],
    antialias: true,
    particles: 0.5,
    shadows: true,
    motionBlur: false,
    envResolution: 64,
    curveSegments: 24,
    ambientMotion: true,
  },
  low: {
    label: "Low",
    description: "Minimum effects, maximum responsiveness.",
    dpr: [0.75, 1],
    antialias: false,
    particles: 0.25,
    shadows: false,
    motionBlur: false,
    envResolution: 32,
    curveSegments: 16,
    ambientMotion: false,
  },
};

export const QUALITY_ORDER: QualityPreset[] = ["low", "balanced", "high", "ultra"];

/** Heuristic starting point for "auto" quality. The runtime monitor can lower it further. */
export function detectDeviceQuality(): QualityPreset {
  if (typeof navigator === "undefined") return "high";
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (mobile) return cores >= 8 && memory >= 6 ? "balanced" : "low";
  if (cores >= 8 && memory >= 8) return "ultra";
  if (cores >= 4) return "high";
  return "balanced";
}

export function lowerQuality(q: QualityPreset): QualityPreset {
  const i = QUALITY_ORDER.indexOf(q);
  return QUALITY_ORDER[Math.max(0, i - 1)];
}
