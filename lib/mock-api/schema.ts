import type {
  ActivityEvent,
  Agent,
  Campaign,
  Reward,
  Sale,
  SpinResult,
  Team,
  TargetRule,
} from "@/types";

/**
 * Shape of the complete mock data set. Everything the UI displays is derived
 * from this single object so KPIs stay consistent across screens.
 */
export interface ArenaData {
  schemaVersion: number;
  /** Local day the "today" data belongs to (YYYY-MM-DD). */
  dayKey: string;
  campaigns: Campaign[];
  teams: Team[];
  agents: Agent[];
  /** Individual sales for the current day (approved, pending, rejected). */
  sales: Sale[];
  /**
   * Compact historical approved-sales counts per agent.
   * Index 0 = yesterday, index 1 = two days ago, … (30 days).
   */
  history: Record<string, number[]>;
  targetRules: TargetRule[];
  rewards: Reward[];
  spins: SpinResult[];
  /** Demo-granted spin credits per agent (on top of rule-earned credits). */
  bonusCredits: Record<string, number>;
  activity: ActivityEvent[];
  currentAgentId: string;
  /** Global target milestones (25/50/75/100) already celebrated today. */
  celebratedMilestones: number[];
  /** Team ids that already reached their daily target today. */
  teamTargetsHit: string[];
  lastSyncAt: string | null;
}

// 4: leads include rejected and duplicate statuses.
export const SCHEMA_VERSION = 4;
export const HISTORY_DAYS = 30;
export const ACTIVITY_LIMIT = 150;
