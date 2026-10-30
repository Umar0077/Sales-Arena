import type { CelebrationTier, SoundCategory } from "@/types";

export interface TierMeta {
  tier: CelebrationTier;
  label: string;
  /** Higher = more important. Used for queue ordering and visual scale. */
  priority: number;
  color: string;
  /** Duration multiplier against the base celebration duration. */
  durationFactor: number;
  /** Particle budget multiplier (scaled by quality + intensity). */
  particles: number;
  sound: SoundCategory;
  /** Whether this tier takes over the full screen (vs. hero/toast only). */
  fullscreen: boolean;
}

export const TIERS: Record<CelebrationTier, TierMeta> = {
  sale: { tier: "sale", label: "Approved Sale", priority: 1, color: "#36E0B5", durationFactor: 0.9, particles: 0.35, sound: "sale", fullscreen: false },
  "spin-unlocked": { tier: "spin-unlocked", label: "Spin Unlocked", priority: 2, color: "#7568FF", durationFactor: 1, particles: 0.6, sound: "spinUnlocked", fullscreen: false },
  milestone: { tier: "milestone", label: "Target Milestone", priority: 3, color: "#27D5FF", durationFactor: 1.15, particles: 0.75, sound: "target", fullscreen: false },
  "top-performer": { tier: "top-performer", label: "New #1", priority: 4, color: "#FFC857", durationFactor: 1.25, particles: 0.85, sound: "special", fullscreen: false },
  "team-target": { tier: "team-target", label: "Team Target Completed", priority: 5, color: "#FFC857", durationFactor: 1.5, particles: 1, sound: "target", fullscreen: true },
  special: { tier: "special", label: "Special Achievement", priority: 6, color: "#FF8FD8", durationFactor: 1.5, particles: 1, sound: "special", fullscreen: true },
};

export const TIER_ORDER: CelebrationTier[] = ["sale", "spin-unlocked", "milestone", "top-performer", "team-target", "special"];
