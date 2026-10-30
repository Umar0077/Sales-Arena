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
import type { CloserRow } from "@/features/sales/leads";

export interface PeriodMetrics {
  summary: {
    range: { from: string | null; to: string | null };
    submitted: number;
    validated: number;
    closeRate: number;
    returned: number;
    rejected: number;
    activeClosers: number;
    premium: { total: number; average: number };
  } | null;
  closers: CloserRow[];
  sales: Sale[];
  dateRange: {
    from: string;
    to: string;
    label: string;
    detailedLabel: string;
  };
  status: "idle" | "loading" | "success" | "ready" | "error";
  lastFetchedAt: string | null;
}

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
  /** Submitted-lead counts per agent for the same past days (index 0 = yesterday). Demo data. */
  historySubmitted: Record<string, number[]>;
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
  dataSourceMode?: "demo" | "production";
  apiSyncStatus?: "connected" | "connecting" | "error" | "unconfigured";
  apiSyncError?: string | null;
  safeQuoteSummary?: {
    range: { from: string | null; to: string | null };
    submitted: number;
    validated: number;
    closeRate: number;
    returned: number;
    rejected: number;
    activeClosers: number;
    premium: { total: number; average: number };
  } | null;
  periodMetrics?: {
    day: PeriodMetrics;
    week: PeriodMetrics;
    month: PeriodMetrics;
    allTime?: {
      summary: ArenaData["safeQuoteSummary"];
      closers: CloserRow[];
    };
  };
  serverSpinBalance?: {
    unlocked: number;
    available: number;
  } | null;
}

// 4: leads include rejected and duplicate statuses.
// 5: submitted-lead history for weekly/monthly arenas.
export const SCHEMA_VERSION = 5;
export const HISTORY_DAYS = 30;
export const ACTIVITY_LIMIT = 150;
