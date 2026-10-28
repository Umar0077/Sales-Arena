import type { Reward, SegmentColorMode, SpinnerTheme } from "@/types";

export interface WheelTheme {
  label: string;
  /** Segment neon colours, cycled around the wheel. */
  palette: string[];
  /** Colour of the rim LEDs (alternating). */
  leds: [string, string];
  /** Accent for the hub ring and pointer gem. */
  accent: string;
}

export const WHEEL_THEMES: Record<SpinnerTheme, WheelTheme> = {
  neon: { label: "Neon Arena", palette: ["#22D3FF", "#FF3DB4", "#8B5CFF", "#4F7BFF"], leds: ["#22D3FF", "#FF3DB4"], accent: "#22D3FF" },
  royal: { label: "Royal Gold", palette: ["#FFC857", "#8B5CFF", "#E9A23B", "#6D4BFF"], leds: ["#FFC857", "#A78BFA"], accent: "#FFC857" },
  aurora: { label: "Aurora", palette: ["#2DE2B4", "#22D3FF", "#7C83FF", "#3BA7FF"], leds: ["#2DE2B4", "#7C83FF"], accent: "#2DE2B4" },
  sunset: { label: "Sunset", palette: ["#FF7A45", "#FF3D8B", "#FFC857", "#C24DFF"], leds: ["#FFB347", "#FF3D8B"], accent: "#FF7A45" },
};

/**
 * Colour for each segment. Theme mode cycles the palette and avoids the same
 * colour on both sides of the seam between the last and first segment.
 */
export function segmentColors(rewards: Reward[], theme: SpinnerTheme, mode: SegmentColorMode): string[] {
  if (mode === "prize") return rewards.map((r) => r.color);
  const pal = WHEEL_THEMES[theme]?.palette ?? WHEEL_THEMES.neon.palette;
  const colors = rewards.map((_, i) => pal[i % pal.length]);
  const n = colors.length;
  if (n > 1 && colors[n - 1] === colors[0]) {
    colors[n - 1] = pal.find((c) => c !== colors[0] && c !== colors[n - 2]) ?? colors[n - 1];
  }
  return colors;
}
