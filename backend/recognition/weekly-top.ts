import type { Pool } from "pg";
import { writeAudit } from "../auth/guard";
import { arenaBroadcaster } from "../events/broadcaster";
import { calendarFrom, readArenaConfig } from "../settings/arena-config";
import { getSafeQuoteClient } from "../safequote/client";
import { mapClosersToCloserRows } from "../safequote/mapper";
import { getPeriodDateRange } from "@/shared/time/business";
import type { CloserRow } from "@/shared/sales/leads";

/**
 * Weekly Top Performer recognition (Admin → Celebrations). A MANUAL, presentation-only celebration:
 *  - the #1 agent is exactly the #1 row of the Weekly leaderboard (Safe Quote's per-closer figures for this business
 *    week, the same mapping and the same campaign filter the Weekly screen uses);
 *  - an Admin triggers it; at most ONE celebration per business week (checked under a row lock, so two clicks or
 *    two Admins can never broadcast twice), audited;
 *  - it is broadcast once on the existing live stream ("arena.recognition.weekly_top"); displays play it through
 *    their existing celebration queue.
 * It never creates or changes a sale, bonus, award, spin credit or any financial figure.
 */

export const RECOGNITION_KEY = "recognition.weekly_top_performer";
export const RECOGNITION_EVENT = "arena.recognition.weekly_top";

export interface WeeklyTopAgent {
  userCode: string;
  name: string;
  validated: number;
  submitted: number;
}
export interface WeeklyCelebrated extends WeeklyTopAgent {
  weekFrom: string;
  weekTo: string;
  at: string;
  by: string | null;
}
export interface WeeklyTopState {
  week: { from: string; to: string; label: string };
  top: WeeklyTopAgent | null;
  /** Another agent has the same approved sales as #1 (the leaderboard's own order decides who is #1). */
  tiedWith: string | null;
  /** This week's celebration, if it already happened. */
  celebrated: WeeklyCelebrated | null;
}

export class RecognitionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type ClosersFetcher = (from: string, to: string, fresh: boolean) => Promise<CloserRow[]>;
const safeQuoteRows: ClosersFetcher = async (from, to, fresh) => mapClosersToCloserRows((await getSafeQuoteClient().getClosers({ from, to }, fresh)).closers);

/** This business week and its #1 (read-only). */
export async function weeklyTopPerformer(pool: Pool, opts: { now?: Date; fresh?: boolean; closers?: ClosersFetcher } = {}): Promise<WeeklyTopState> {
  const cfg = (await readArenaConfig(pool)).values;
  const range = getPeriodDateRange("week", calendarFrom(cfg), opts.now);
  let rows = await (opts.closers ?? safeQuoteRows)(range.from, range.to, opts.fresh === true);
  // The Weekly leaderboard's own filter (Admin → Leaderboard → campaign), so the #1 here is the #1 on the screen.
  const campaignId = typeof cfg.leaderboardCampaignId === "string" && cfg.leaderboardCampaignId ? cfg.leaderboardCampaignId : null;
  if (campaignId) rows = rows.filter((r) => r.agent.campaignId === campaignId);
  rows = rows.filter((r) => r.counts.validated > 0); // a celebration needs at least one approved sale
  const first = rows[0];
  const top = first ? { userCode: String(first.code || first.agent.id), name: first.agent.name, validated: first.counts.validated, submitted: first.counts.submitted } : null;
  const tied = first && rows[1] && rows[1].counts.validated === first.counts.validated ? rows[1].agent.name : null;
  const stored = (await pool.query(`SELECT s.value, u.email FROM admin_settings s LEFT JOIN admin_users u ON u.id::text = s.value->>'adminId' WHERE s.key = $1`, [RECOGNITION_KEY])).rows[0];
  const v = stored?.value as (Omit<WeeklyCelebrated, "by"> & { adminId?: string }) | undefined;
  const celebrated = v && v.weekFrom === range.from ? { userCode: v.userCode, name: v.name, validated: v.validated, submitted: v.submitted, weekFrom: v.weekFrom, weekTo: v.weekTo, at: v.at, by: stored.email ?? null } : null;
  return { week: { from: range.from, to: range.to, label: range.detailedLabel }, top, tiedWith: tied, celebrated };
}

/** Celebrates this week's #1 once (fresh figures, never trusted from the browser) and broadcasts it. */
export async function celebrateWeeklyTop(
  pool: Pool,
  actor: { adminId: string; ip: string | null; userAgent: string | null },
  opts: { now?: Date; closers?: ClosersFetcher } = {},
): Promise<{ id: string; week: WeeklyTopState["week"]; top: WeeklyTopAgent }> {
  const state = await weeklyTopPerformer(pool, { ...opts, fresh: true });
  if (!state.top) throw new RecognitionError(422, "No approved sales this week yet: there is no top performer to celebrate.");
  const top = state.top;
  const id = `weekly-top:${state.week.from}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO admin_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [RECOGNITION_KEY, JSON.stringify({})]);
    const cur = (await client.query(`SELECT value FROM admin_settings WHERE key = $1 FOR UPDATE`, [RECOGNITION_KEY])).rows[0].value as { weekFrom?: string; at?: string; name?: string };
    if (cur.weekFrom === state.week.from) {
      await client.query("ROLLBACK");
      throw new RecognitionError(409, `This week's top performer was already celebrated (${cur.name ?? "agent"}, ${cur.at ? new Date(cur.at).toLocaleString("en-US") : "earlier"}).`);
    }
    const at = new Date().toISOString();
    const value = { weekFrom: state.week.from, weekTo: state.week.to, userCode: top.userCode, name: top.name, validated: top.validated, submitted: top.submitted, at, adminId: actor.adminId };
    await client.query(`UPDATE admin_settings SET value = $2 WHERE key = $1`, [RECOGNITION_KEY, JSON.stringify(value)]);
    await writeAudit(client, {
      adminId: actor.adminId,
      action: "recognition.weekly_top.celebrated",
      targetType: "agent",
      targetId: top.userCode,
      details: { week: `${state.week.from}..${state.week.to}`, name: top.name, validated: top.validated },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  // After the commit: one live event to every display (they dedupe by id).
  arenaBroadcaster.broadcast(RECOGNITION_EVENT, { id, from: state.week.from, to: state.week.to, label: state.week.label, userCode: top.userCode, name: top.name, validated: top.validated, at: new Date().toISOString() });
  return { id, week: state.week, top };
}
