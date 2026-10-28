/**
 * Frame-time instrumentation.
 *
 * How FPS is measured
 * -------------------
 * - A `requestAnimationFrame` loop records the delta between consecutive
 *   callback timestamps (the browser's frame clock).
 * - Current FPS  = frames counted in the last ~1 s window ÷ window length.
 * - Rolling FPS  = 1000 ÷ mean frame time over the last 600 frames (~10 s at 60 Hz).
 * - The display refresh interval is estimated from the 10th-percentile frame time.
 * - Dropped frames = Σ max(0, round(delta ÷ refreshInterval) − 1).
 *
 * The spinner additionally records the R3F frame deltas during each spin into a
 * pre-allocated buffer (no allocations in the frame loop) — see `SpinRecorder`.
 */

export interface FrameStats {
  fps: number;
  avgFps: number;
  frameTimeAvg: number;
  frameTimeP95: number;
  frameTimeMax: number;
  dropped: number;
  refreshInterval: number;
  samples: number;
}

const EMPTY: FrameStats = { fps: 0, avgFps: 0, frameTimeAvg: 0, frameTimeP95: 0, frameTimeMax: 0, dropped: 0, refreshInterval: 16.67, samples: 0 };

export function computeFrameStats(deltas: ArrayLike<number>, count: number, windowFps?: number): FrameStats {
  if (count < 2) return { ...EMPTY };
  const arr = Array.from({ length: count }, (_, i) => deltas[i]).filter((d) => d > 0 && d < 1000);
  if (arr.length < 2) return { ...EMPTY };
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = arr.reduce((t, d) => t + d, 0);
  const avg = sum / arr.length;
  const refresh = Math.max(4, sorted[Math.floor(sorted.length * 0.1)]);
  let dropped = 0;
  for (const d of arr) dropped += Math.max(0, Math.round(d / refresh) - 1);
  return {
    fps: windowFps ?? 1000 / avg,
    avgFps: 1000 / avg,
    frameTimeAvg: avg,
    frameTimeP95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    frameTimeMax: sorted[sorted.length - 1],
    dropped,
    refreshInterval: refresh,
    samples: arr.length,
  };
}

export class FrameMonitor {
  private buffer = new Float32Array(600);
  private index = 0;
  private filled = 0;
  private last = 0;
  private raf = 0;
  private windowStart = 0;
  private windowFrames = 0;
  private windowFps = 0;
  private listeners = new Set<(s: FrameStats) => void>();
  private lastEmit = 0;

  start(): void {
    if (this.raf || typeof window === "undefined") return;
    const loop = (t: number) => {
      if (this.last) {
        const d = t - this.last;
        this.buffer[this.index] = d;
        this.index = (this.index + 1) % this.buffer.length;
        this.filled = Math.min(this.buffer.length, this.filled + 1);
      }
      this.last = t;
      this.windowFrames++;
      if (!this.windowStart) this.windowStart = t;
      if (t - this.windowStart >= 1000) {
        this.windowFps = (this.windowFrames * 1000) / (t - this.windowStart);
        this.windowStart = t;
        this.windowFrames = 0;
      }
      if (t - this.lastEmit > 500) {
        this.lastEmit = t;
        const stats = this.snapshot();
        this.listeners.forEach((l) => l(stats));
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
    this.windowStart = 0;
  }

  snapshot(): FrameStats {
    return computeFrameStats(this.buffer, this.filled, this.windowFps || undefined);
  }

  subscribe(fn: (s: FrameStats) => void): () => void {
    this.listeners.add(fn);
    this.start();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.stop();
    };
  }
}

export const frameMonitor = new FrameMonitor();

/** Allocation-free recorder used inside the spinner's frame loop. */
export class SpinRecorder {
  private buffer = new Float32Array(4096);
  private count = 0;
  active = false;

  begin(): void {
    this.count = 0;
    this.active = true;
  }

  push(deltaMs: number): void {
    if (!this.active || this.count >= this.buffer.length) return;
    this.buffer[this.count++] = deltaMs;
  }

  end(): FrameStats {
    this.active = false;
    return computeFrameStats(this.buffer, this.count);
  }
}
