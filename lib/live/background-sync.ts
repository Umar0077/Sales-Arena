/**
 * One background sync loop (no page reloads). Used once per Live Arena display and once per Admin tab.
 *
 *  - every intervalMs() ± jitter, read at each tick so an admin change applies without a restart;
 *  - single flight: a tick never starts while the previous one runs; trigger() while running is coalesced;
 *  - every run gets an AbortSignal; stop(), a page hide and a newer forced run abort the obsolete one;
 *  - errors back off (×2 up to maxBackoffMs) and recover on the next success;
 *  - paused while the page is hidden; on return it runs at once if the last success is older than one interval.
 *
 * SSE stays the instant path: this only catches up on anything a live event did not deliver.
 */

export interface BackgroundSyncOptions {
  intervalMs: () => number;
  run: (signal: AbortSignal) => Promise<void>;
  /** ± fraction of the interval, so many displays never check in lock-step. Default 0.1. */
  jitter?: number;
  maxBackoffMs?: number;
  /** Defaults to the document's visibility. */
  isVisible?: () => boolean;
  random?: () => number;
}

export interface BackgroundSync {
  start: () => void;
  stop: () => void;
  /** Run now (coalesced with a run in progress), then continue on the normal schedule. */
  trigger: () => Promise<void>;
  /** Diagnostics. */
  state: () => { running: boolean; failures: number; lastSuccessAt: number; runs: number };
}

export const MIN_INTERVAL_MS = 10_000;
export const MAX_INTERVAL_MS = 120_000;
export const clampInterval = (ms: number) => (Number.isFinite(ms) ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms)) : 15_000);

export function createBackgroundSync(o: BackgroundSyncOptions): BackgroundSync {
  const jitter = o.jitter ?? 0.1;
  const maxBackoff = o.maxBackoffMs ?? 120_000;
  const rnd = o.random ?? Math.random;
  const visible = o.isVisible ?? (() => typeof document === "undefined" || document.visibilityState === "visible");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;
  let ctrl: AbortController | null = null;
  let failures = 0;
  let lastSuccessAt = 0;
  let runs = 0;
  let started = false;

  const delay = () => {
    const base = clampInterval(o.intervalMs());
    const backoff = failures ? Math.min(maxBackoff, base * 2 ** Math.min(failures, 6)) : base;
    return Math.max(1000, Math.round(backoff * (1 + (rnd() * 2 - 1) * jitter)));
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = started ? setTimeout(tick, delay()) : null;
  };
  const exec = (): Promise<void> => {
    if (inflight) return inflight;
    ctrl = new AbortController();
    const signal = ctrl.signal;
    runs++;
    inflight = o
      .run(signal)
      .then(() => {
        if (!signal.aborted) {
          failures = 0;
          lastSuccessAt = Date.now();
        }
      })
      .catch(() => {
        if (!signal.aborted) failures++;
      })
      .finally(() => {
        inflight = null;
        ctrl = null;
      });
    return inflight;
  };
  const tick = () => {
    timer = null;
    if (!started) return;
    if (!visible()) return; // resumes on visibilitychange
    void exec().finally(schedule);
  };
  const onVisibility = () => {
    if (!started) return;
    if (visible()) {
      if (Date.now() - lastSuccessAt >= clampInterval(o.intervalMs())) tick();
      else schedule();
    } else {
      if (timer) clearTimeout(timer);
      timer = null;
      ctrl?.abort(); // nothing is shown while hidden: drop the request in flight
    }
  };

  return {
    start() {
      if (started) return;
      started = true;
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
      schedule();
    },
    stop() {
      started = false;
      if (timer) clearTimeout(timer);
      timer = null;
      ctrl?.abort();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    },
    trigger() {
      const p = exec();
      void p.finally(schedule);
      return p;
    },
    state: () => ({ running: Boolean(inflight), failures, lastSuccessAt, runs }),
  };
}
