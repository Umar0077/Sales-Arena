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
    label: "High Quality",
    description: "Full premium visual styling and smooth 3D animations.",
    dpr: [1, 1.5],
    antialias: true,
    particles: 0.8,
    shadows: true,
    motionBlur: false,
    envResolution: 128,
    curveSegments: 36,
    ambientMotion: true,
  },
  balanced: {
    label: "Balanced",
    description: "Reduced particles and simplified effects.",
    dpr: [1, 1.25],
    antialias: true,
    particles: 0.5,
    shadows: false,
    motionBlur: false,
    envResolution: 64,
    curveSegments: 24,
    ambientMotion: true,
  },
  low: {
    label: "Performance",
    description: "Maximum speed for low-end laptops, integrated GPUs, and office PCs.",
    dpr: [0.75, 1],
    antialias: false,
    particles: 0.2,
    shadows: false,
    motionBlur: false,
    envResolution: 32,
    curveSegments: 16,
    ambientMotion: false,
  },
  performance: {
    label: "Performance",
    description: "Optimized for low-spec PCs, minimal GPU overhead, and instant response.",
    dpr: [0.75, 1],
    antialias: false,
    particles: 0.2,
    shadows: false,
    motionBlur: false,
    envResolution: 32,
    curveSegments: 16,
    ambientMotion: false,
  },
};

export const QUALITY_ORDER: QualityPreset[] = ["performance", "low", "balanced", "high", "ultra"];

/**
 * Intelligent hardware detection:
 * Checks CPU cores, memory, mobile user agent, AND queries the WebGL
 * unmasked renderer string to detect low-end or integrated GPUs.
 */
export function detectDeviceQuality(): QualityPreset {
  if (typeof navigator === "undefined" || typeof window === "undefined") return "high";

  // 1. Check for reduced motion preference
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return "performance";
  }

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  // 2. Inspect WebGL GPU renderer string if available
  let isLowEndGpu = false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl) {
      const debugInfo = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        const renderer = String((gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "").toLowerCase();
        if (
          renderer.includes("intel hd") ||
          renderer.includes("intel uhd") ||
          renderer.includes("intel iris") ||
          renderer.includes("mali") ||
          renderer.includes("adreno") ||
          renderer.includes("powervr") ||
          renderer.includes("llvmpipe") ||
          renderer.includes("swiftshader") ||
          renderer.includes("microsoft basic")
        ) {
          isLowEndGpu = true;
        }
      }
    }
  } catch {
    // Ignore context failure
  }

  if (mobile || isLowEndGpu || cores <= 4 || memory <= 4) {
    return "performance";
  }

  return "high";
}

export function lowerQuality(q: QualityPreset): QualityPreset {
  const i = QUALITY_ORDER.indexOf(q);
  return QUALITY_ORDER[Math.max(0, i - 1)];
}
