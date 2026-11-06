"use client";

/**
 * Safety release for a popup whose exit animation never reports back, without cutting a SLOW exit short.
 *
 * A popup's exit normally confirms itself (AnimatePresence onExitComplete) within ~0.3 s. When it does not:
 *  - tab hidden (no frames are drawn, the exit cannot run): release after `afterMs`;
 *  - page visible and drawing frames: the exit is still progressing, only slowly (a very slow PC can draw a frame
 *    every 1–2 s). Release only once `frames` more frames have been drawn after `afterMs` — by then the exit has
 *    certainly finished — so the next popup never appears on top of one that is still fading out;
 *  - page visible but drawing nothing at all (frozen): release at `capMs` at the latest, so nothing waits forever.
 * Returns a cancel function (call it when the exit confirmed itself, or on unmount).
 */
export function whenExitStalled(onRelease: () => void, opts: { afterMs?: number; frames?: number; capMs?: number } = {}): () => void {
  const { afterMs = 1500, frames = 6, capMs = 12_000 } = opts;
  let done = false;
  let raf = 0;
  let seen = 0;
  const release = () => {
    if (done) return;
    done = true;
    cleanup();
    onRelease();
  };
  const frame = () => {
    if (++seen >= frames) return release();
    raf = requestAnimationFrame(frame);
  };
  const t = setTimeout(() => {
    if (document.visibilityState === "hidden") return release();
    raf = requestAnimationFrame(frame);
  }, afterMs);
  const onVis = () => {
    if (document.visibilityState === "hidden" && performance.now() - startedAt >= afterMs) release();
  };
  const startedAt = performance.now();
  const cap = setTimeout(release, capMs);
  document.addEventListener("visibilitychange", onVis);
  function cleanup() {
    clearTimeout(t);
    clearTimeout(cap);
    cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onVis);
  }
  return () => {
    done = true;
    cleanup();
  };
}
