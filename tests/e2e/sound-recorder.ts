import type { Page } from "@playwright/test";

/**
 * Test-only observer of what the Live Arena actually plays, WITHOUT touching the app's audio code:
 *  - the original synthesized sounds (validated sale, Sigma / Panthers stingers) play through Howler: every
 *    Howl.play() is recorded and identified by the rendered sound's length (sale 1.1 s, Sigma "royal" 2.4 s,
 *    Panthers "electric" 1.9 s, other teams "neutral" 1.5 s; anything else is listed by its length);
 *  - the cash bonus trumpet plays through the celebration sound player, which records its own decisions.
 */
export async function installSoundRecorder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    let H: unknown;
    Object.defineProperty(window, "Howl", {
      configurable: true,
      get: () => H,
      set(v: { prototype: { play: (...a: unknown[]) => unknown } }) {
        H = v;
        const orig = v.prototype.play;
        v.prototype.play = function (this: unknown, ...a: unknown[]) {
          // play(id) with a numeric sound id is Howler replaying its own queued call once the file has loaded:
          // the same playback, not a new one. Only calls from the app (no id) are recorded.
          if (typeof a[0] !== "number") ((w.__howlPlays as unknown[]) ??= (w.__howlPlays = [])).push({ h: this, at: Math.round(performance.now()) });
          return orig.apply(this, a);
        };
      },
    });
  });
}

/** Names of the sounds played so far, in order (each entry = one actual playback). */
export function playedSounds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __howlPlays?: Array<{ h: { _duration?: number }; at: number }>;
      __celebrationSounds?: Array<{ id: string; result: string; at: number }>;
    };
    const name = (d: number) => {
      const r = Math.round(d * 10) / 10;
      return r === 1.1 ? "sale" : r === 2.4 ? "sigma" : r === 1.9 ? "panthers" : r === 1.5 ? "team" : `other:${r}s`;
    };
    const howl = (w.__howlPlays ?? []).map((p) => ({ n: name(p.h._duration ?? 0), at: p.at }));
    const bonus = (w.__celebrationSounds ?? []).filter((r) => r.result === "played").map((r) => ({ n: r.id, at: r.at }));
    return [...howl, ...bonus].sort((a, b) => a.at - b.at).map((x) => x.n);
  });
}
