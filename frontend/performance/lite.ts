"use client";

import { useSettingsStore } from "@/frontend/stores/settings-store";
import { useTeamCelebrationStore } from "@/frontend/stores/team-celebration-store";

/**
 * Lite display: the lighter version of the celebrations (fewer particles, no decorative light passes or full-screen
 * backdrop blur), never fewer notifications and never muted. On when:
 *  - the display is in Performance mode (Admin → Global Display Performance), or
 *  - the quality is Auto and this device is a weak one (existing device check) or was MEASURED struggling during
 *    earlier celebrations (frame pacing recorded while they played).
 * Reduced motion is separate (the viewer's own preference) and always honoured on its own.
 */
export function isLiteDisplay(s: { quality: string; autoQuality: string }, measured: boolean): boolean {
  return s.quality === "performance" || (s.quality === "auto" && (s.autoQuality === "performance" || s.autoQuality === "low" || measured));
}

export function useLiteDisplay(): boolean {
  const quality = useSettingsStore((s) => s.quality);
  const autoQuality = useSettingsStore((s) => s.autoQuality);
  const measured = useTeamCelebrationStore((s) => s.measuredLite);
  return isLiteDisplay({ quality, autoQuality }, measured);
}
