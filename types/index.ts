/**
 * SALES ARENA — core domain types.
 *
 * These interfaces are the contract between the UI and any data provider.
 * The demo ships with mock providers (see `lib/mock-api`), but a production
 * implementation only needs to satisfy the same shapes.
 */

export type ID = string;
export type ISODate = string;

export interface Campaign {
  id: ID;
  name: string;
  /** Hex colour used for chips and charts. */
  color: string;
  product: string;
}

export interface Team {
  id: ID;
  name: string;
  color: string;
  campaignId: ID;
  leadName: string;
  active: boolean;
}

export interface Agent {
  id: ID;
  name: string;
  initials: string;
  teamId: ID;
  campaignId: ID;
  active: boolean;
  title: string;
  /** Avatar gradient hue (0–360). */
  hue: number;
  joinedAt: ISODate;
  /** Safe Quote userCode (live data only). Server spin APIs are keyed by it. */
  userCode?: string;
}

/** "approved" = validated sale. All other statuses are submitted leads that never earn spins. */
export type SaleStatus = "approved" | "pending" | "rejected" | "duplicate";
export type SaleSource = "seed" | "demo-simulator" | "integration-preview" | "safequote-api";

export interface Sale {
  id: ID;
  agentId: ID;
  teamId: ID;
  campaignId: ID;
  status: SaleStatus;
  product: string;
  value: number;
  createdAt: ISODate;
  approvedAt: ISODate | null;
  source: SaleSource;
  carrier?: string;
  state?: string;
  coverage?: string | number;
  closerName?: string;
  closerCode?: string;
}

export type TargetPeriod = "daily" | "weekly";

export interface TargetRule {
  id: ID;
  /** `null` means the default rule applied to teams without a specific rule. */
  teamId: ID | null;
  /** Approved sales required to earn one spin credit. */
  salesPerSpin: number;
  period: TargetPeriod;
  enabled: boolean;
  /** Team-level approved sales target per day. */
  teamDailyTarget: number;
  /** Individual agent target per day. */
  agentDailyTarget: number;
}

export interface SpinCredit {
  agentId: ID;
  earned: number;
  bonus: number;
  used: number;
  available: number;
  /** Approved sales counted towards the current rule period. */
  periodSales: number;
  salesPerSpin: number;
  /** Sales still needed for the next credit (null when targets are disabled). */
  salesToNext: number | null;
  ruleEnabled: boolean;
}

export type RewardIcon =
  | "trophy"
  | "gift"
  | "package"
  | "headphones"
  | "badge"
  | "sparkles"
  | "coffee"
  | "ticket"
  | "star"
  | "crown"
  | "rocket"
  | "medal";

export interface Reward {
  id: ID;
  title: string;
  description: string;
  icon: RewardIcon;
  color: string;
  active: boolean;
  /** `null` = unlimited. */
  quantity: number | null;
  /** Relative selection weight for the simulated selector. */
  weight: number;
  order: number;
}

export type SpinStatus = "in-progress" | "completed" | "fulfilled" | "cancelled";
export type SpinSelectionMode = "simulated" | "seeded-test" | "server";

export interface SpinResult {
  id: ID;
  agentId: ID;
  rewardId: ID;
  /** Snapshot so history stays readable if a reward is renamed or deleted. */
  rewardTitle: string;
  rewardColor: string;
  rewardIcon: RewardIcon;
  createdAt: ISODate;
  completedAt: ISODate | null;
  status: SpinStatus;
  mode: SpinSelectionMode;
  seed: number | null;
}

export type CelebrationTier =
  | "sale"
  | "milestone"
  | "spin-unlocked"
  | "top-performer"
  | "team-target"
  | "special";

export interface CelebrationEvent {
  id: ID;
  tier: CelebrationTier;
  headline: string;
  subline: string;
  agentId: ID | null;
  agentName: string | null;
  teamName: string | null;
  teamColor: string | null;
  value: number | null;
  createdAt: ISODate;
  /** True for previews that did not change data. */
  preview: boolean;
}

export type ActivityType =
  | "sale-approved"
  | "sale-pending"
  | "spin-unlocked"
  | "milestone"
  | "top-performer"
  | "team-target"
  | "special"
  | "spin-completed"
  | "admin-change"
  | "bonus-awarded"
  | "integration";

export interface ActivityEvent {
  id: ID;
  type: ActivityType;
  message: string;
  agentId: ID | null;
  teamId: ID | null;
  createdAt: ISODate;
  simulated: boolean;
}

export interface ArenaStatistics {
  approvedToday: number;
  pendingToday: number;
  targetToday: number;
  remaining: number;
  completion: number;
  achievementsToday: number;
  activeAgents: number;
  totalAgents: number;
  spinsUnlocked: number;
  spinsUsed: number;
  spinsAvailable: number;
  rewardsIssued: number;
  teams: number;
  activeTargets: number;
}

export type QualityPreset = "ultra" | "high" | "balanced" | "low" | "performance";
export type QualitySetting = "auto" | "high" | "performance" | "ultra" | "balanced" | "low";
export type VisualIntensity = "calm" | "standard" | "epic";
export type MotionPreference = "system" | "reduced" | "full";
export type AccentTheme = "violet" | "cyan" | "emerald" | "gold";

export type SoundCategory =
  | "sale"
  | "target"
  | "spinUnlocked"
  | "wheelActivate"
  | "wheelMove"
  | "tick"
  | "reveal"
  | "ui"
  | "special";

/** Live Arena screens. "spin" is the original Spin & Win screen. */
export type ArenaMode = "daily" | "weekly" | "monthly" | "spin";

export type SpinnerTheme = "neon" | "royal" | "aurora" | "sunset";
export type SegmentColorMode = "theme" | "prize";
export type BackgroundEffects = "full" | "subtle" | "off";
export type LeaderboardCriteria = "sales" | "value";
export type LeaderboardSize = "compact" | "comfortable";
export type TopPerformerStyle = "podium" | "highlight" | "minimal";
export type SaleCelebrationStyle = "toast" | "banner" | "off";
export type RevealStyle = "cinematic" | "minimal";

export interface DisplaySettings {
  intensity: VisualIntensity;
  particles: boolean;
  soundEnabled: boolean;
  volume: number;
  soundCategories: Record<SoundCategory, boolean>;
  /** Base celebration duration in seconds. */
  celebrationDuration: number;
  quality: QualitySetting;
  spinnerFallback2D?: boolean;
  motion: MotionPreference;
  accent: AccentTheme;
  diagnostics: boolean;
  tvMode: boolean;
  /** Use a deterministic seed for the simulated reward selector. */
  seededSpins: boolean;
  spinSeed: number;

  // ---- Spinner appearance ----
  spinnerTheme: SpinnerTheme;
  /** "theme" uses the theme palette for segments; "prize" uses each reward's own colour. */
  segmentColorMode: SegmentColorMode;
  /** Neon glow strength, 0 (off) – 1.5. */
  glowIntensity: number;
  /** Idle light-chase animation around the wheel. */
  spinnerLights: boolean;
  /** Speed multiplier for the light chase, 0.5 – 2. */
  lightSpeed: number;
  /** Multiplier on spin duration, 0.6 – 1.6. */
  spinDurationScale: number;

  // ---- Live Arena ----
  /** Master switch for the public Live Arena display. Off shows an "offline" screen. */
  arenaEnabled: boolean;
  arenaOfflineMessage: string;
  brandName: string;
  brandTagline: string;
  /** Uploaded logo as a data URL (browser storage only), or null for the default logo. */
  customLogo: string | null;
  backgroundEffects: BackgroundEffects;
  showKpis: boolean;
  showHero: boolean;
  showActivity: boolean;
  /** Generate demo sales automatically on the Live Arena display. */
  autoSimulate: boolean;
  autoSimulateEverySec: number;
  /** Small "Demo spin" button on the Live Arena for presentations. */
  showDemoSpinButton: boolean;

  // ---- Leaderboard ----
  leaderboardVisible: boolean;
  leaderboardCount: number;
  leaderboardCriteria: LeaderboardCriteria;
  leaderboardPeriod: LeaderboardPeriod;
  leaderboardTeamId: string | null;
  leaderboardCampaignId: string | null;
  leaderboardAnimations: boolean;
  leaderboardSize: LeaderboardSize;
  topPerformerStyle: TopPerformerStyle;

  // ---- Celebrations & spin flow ----
  saleCelebrationStyle: SaleCelebrationStyle;
  announceMilestones: boolean;
  announceTeamTargets: boolean;
  /** Master switch for spin rewards on the Live Arena. */
  spinFeatureEnabled: boolean;
  /** Show the "target completed → SPIN NOW" popup when a spin is earned. */
  spinFlowEnabled: boolean;
  /** Close an unanswered SPIN NOW popup after N seconds (0 = keep open). The spin stays available. */
  spinPopupTimeoutSec: number;
  /** Templates: {agent}, {sales}, {spins}, {prize}. */
  achievementHeadline: string;
  achievementMessage: string;
  achievementReward: string;
  revealHeadline: string;
  revealMessage: string;
  revealStyle: RevealStyle;

  // ---- Arena screens & reward programs ----
  /** Which Live Arena screens are available. */
  arenaModes: Record<ArenaMode, boolean>;
  defaultArenaMode: ArenaMode;
  /** Show the screen selector on the Live Arena display. */
  showModeSelector: boolean;
  /** Off (default): a validated sale only counts for the bonus program of the default screen. Spin & Win is separate. */
  programsConcurrent: boolean;
  /** IANA timezone for day/week/month boundaries; "" = this device's timezone. */
  businessTimezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekStartDay: number;
  weeklyFloorTarget: number;
  monthlyFloorTarget: number;
  currencyLabel: string;
}

export type LeaderboardPeriod = "daily" | "weekly" | "monthly";

export interface LeaderboardEntry {
  agent: Agent;
  team: Team | undefined;
  sales: number;
  rank: number;
  /** Positive = moved up compared with one hour ago. */
  movement: number;
  progress: number;
}

export interface TeamStanding {
  team: Team;
  sales: number;
  target: number;
  progress: number;
  agents: number;
  rank: number;
}
