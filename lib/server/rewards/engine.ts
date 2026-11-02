import type { PoolClient } from "pg";
import { periodWindow, type BusinessCalendar, type RulePeriod } from "../spins/rules";
import { duplicateProgramIds, rowToProgram, type RewardProgram } from "./programs";

/**
 * Daily / weekly / monthly reward programs (server side). Any number of programs per category.
 *
 * Runs inside the transaction that recorded a NEW live (SSE / reconciliation) validated sale (never for
 * historical backfill). Programs come only from reward_programs: no built-in amounts exist.
 *
 * For each Program-Active, non-archived program in an Active category whose date window and
 * eligibility scope include the sale:
 *   counted = live (non-backfill), still-validated sales of this agent from the later of
 *             (period start in business time, spin activation cutoff if set, program active_since)
 *   earned  = min(maxAwards, prior + floor(counted / salesRequired))   (prior = Owner-recovered or pre-activation awards)
 * Award ids are deterministic (program:userCode:periodKey:n) and the primary key makes them
 * unique, so duplicate deliveries / reconciliation overlap can never award twice.
 *
 * Stacking: a non-stackable program does not award when the agent already has another award in
 * the same category and period; if several non-stackable programs unlock on the same sale, only
 * the highest threshold awards. Stackable programs always award independently.
 */

export interface BonusAwardRecord {
  id: string;
  programId: string;
  programName: string;
  kind: "daily" | "weekly" | "monthly";
  rewardType: string;
  amount: number;
  currency: string;
  prizeLabel: string;
  periodKey: string;
  n: number;
  validatedCount: number;
  salesRequired: number;
  /** Program and category allow a public announcement (checked again by the displays). */
  announce: boolean;
  createdAt: string;
}

export interface RewardEngineConfig {
  categories: Record<string, { active: boolean; showOnArena: boolean }>;
  arenaEnabled: boolean;
  celebrationPopups: boolean;
  announceCash: boolean;
  announcePrizes: boolean;
}

const KIND_TO_PERIOD: Record<string, RulePeriod> = { daily: "daily", weekly: "weekly", monthly: "monthly" };

function ymdInZone(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function inScope(p: RewardProgram, userCode: string, campaignId: string | null): boolean {
  if (p.scopeType === "agents") return p.scopeIds.includes(userCode);
  if (p.scopeType === "campaign") return !!campaignId && p.scopeIds.includes(campaignId);
  return true;
}

export async function evaluateBonusAwards(
  client: PoolClient,
  args: {
    userCode: string;
    agentId: string;
    closerName: string;
    saleId: string;
    caseId?: string;
    validatedAt: Date;
    /** Spin activation cutoff; when set it is an extra floor for bonuses too. null = no extra floor. */
    cutoff: Date | null;
    calendar: BusinessCalendar;
    config: RewardEngineConfig;
    /** Evaluate only these programs (Owner-approved catch-up). Default: all active programs. */
    onlyProgramIds?: string[];
  },
): Promise<BonusAwardRecord[]> {
  // One evaluation per agent at a time: a second concurrent sale waits here, then sees the first one.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('bonus:' || $1))`, [args.userCode]);

  const activeKinds = Object.entries(args.config.categories).filter(([, c]) => c.active).map(([k]) => k);
  if (!activeKinds.length) return [];
  const programs = (
    await client.query(
      `SELECT id, kind, name, description, reward_type, amount, currency, prize_label, sales_required, max_awards, max_total_awards,
              to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, scope_type, scope_ids,
              stackable, enabled, show_on_arena, headline, message, reward_line, sound, accent, popup_seconds, leaderboard_count,
              active_since, archived_at, revision, created_at, updated_at
         FROM reward_programs WHERE enabled AND archived_at IS NULL AND kind = ANY($1)
        ORDER BY stackable, sales_required DESC, id`,
      [activeKinds],
    )
  ).rows.map((r) => rowToProgram(r));
  if (!programs.length) return [];
  // Duplicate protection: identical active programs (same period, threshold, eligibility and reward type)
  // would pay the same milestone twice. Only the oldest one awards; the duplicates are skipped and shown
  // to the Owner in Admin → Reward Programs. Program records are never modified here.
  const dupes = duplicateProgramIds(programs);
  for (let i = programs.length - 1; i >= 0; i--) if (dupes.has(programs[i].id)) programs.splice(i, 1);
  // Owner-approved catch-up can limit evaluation to the programs the Owner selected.
  if (args.onlyProgramIds) for (let i = programs.length - 1; i >= 0; i--) if (!args.onlyProgramIds.includes(programs[i].id)) programs.splice(i, 1);

  const campaignId = ((await client.query(`SELECT campaign_id FROM agents WHERE user_code = $1`, [args.userCode])).rows[0]?.campaign_id as string | null) ?? null;
  const saleDay = ymdInZone(args.validatedAt, args.calendar.timezone);
  const out: BonusAwardRecord[] = [];
  const countCache = new Map<string, number>();

  for (const p of programs) {
    const period = KIND_TO_PERIOD[p.kind];
    if (!period) continue;
    if ((p.startDate && saleDay < p.startDate) || (p.endDate && saleDay > p.endDate)) continue;
    if (!inScope(p, args.userCode, campaignId)) continue;
    // A sale validated before the program was (re)activated never counts for it.
    if (p.activeSince && args.validatedAt.getTime() < new Date(p.activeSince).getTime()) continue;

    const win = periodWindow(period, args.validatedAt, args.calendar);
    const from = new Date(Math.max(win.start?.getTime() ?? 0, args.cutoff?.getTime() ?? 0, p.activeSince ? new Date(p.activeSince).getTime() : 0));
    const ck = `${from.getTime()}|${win.end?.getTime()}`;
    let validated = countCache.get(ck);
    if (validated === undefined) {
      validated = (
        await client.query(
          `SELECT COUNT(*)::int AS n FROM validated_sales
            WHERE user_code = $1 AND source <> 'backfill' AND status = 'validated' AND validated_at >= $2 AND validated_at < $3`,
          [args.userCode, from, win.end],
        )
      ).rows[0].n as number;
      countCache.set(ck, validated);
    }
    // Awards earned in this period before the program was (re)activated, and Owner-recovered awards (they
    // stand for sales this engine never counts), stay; sales counted since activation add to them.
    const prior = (
      await client.query(
        `SELECT COALESCE(MAX(n), 0)::int AS have, COUNT(*) FILTER (WHERE created_at < $4 OR source = 'recovery')::int AS before
           FROM bonus_awards WHERE program_id = $1 AND user_code = $2 AND period_key = $3`,
        [p.id, args.userCode, win.key, p.activeSince ? new Date(p.activeSince) : new Date(0)],
      )
    ).rows[0] as { have: number; before: number };
    const have = prior.have;
    const earned = Math.min(p.maxAwards, prior.before + Math.floor(validated / p.salesRequired));
    if (earned <= have) continue;

    if (!p.stackable) {
      const others = (
        await client.query(`SELECT COUNT(*)::int AS n FROM bonus_awards WHERE kind = $1 AND user_code = $2 AND period_key = $3 AND program_id <> $4 AND status NOT IN ('reversed', 'cancelled')`, [p.kind, args.userCode, win.key, p.id])
      ).rows[0].n as number;
      if (others > 0 || out.some((a) => a.kind === p.kind)) continue;
    }

    let room = earned - have;
    if (p.maxTotalAwards !== null) {
      await client.query(`SELECT 1 FROM reward_programs WHERE id = $1 FOR UPDATE`, [p.id]); // serialise the shared cap
      const total = (await client.query(`SELECT COUNT(*)::int AS n FROM bonus_awards WHERE program_id = $1 AND period_key = $2`, [p.id, win.key])).rows[0].n as number;
      room = Math.min(room, Math.max(0, p.maxTotalAwards - total));
    }

    const cat = args.config.categories[p.kind];
    const cash = p.rewardType === "cash";
    const announce = args.config.arenaEnabled && args.config.celebrationPopups && !!cat?.showOnArena && p.showOnArena && (cash ? args.config.announceCash : args.config.announcePrizes);
    const snap = { name: p.name, rewardType: p.rewardType, amount: p.amount, currency: p.currency, prizeLabel: p.prizeLabel, salesRequired: p.salesRequired, description: p.description, revision: p.revision };

    for (let n = have + 1; n <= have + room; n++) {
      const id = `${p.id}:${args.userCode}:${win.key}:${n}`;
      const ins = await client.query(
        `INSERT INTO bonus_awards (id, program_id, kind, agent_id, user_code, agent_name, period_key, n, validated_at_award, amount,
                                   prize_label, program_name, sales_required, status, trigger_sale_id, trigger_case_id, reward_type,
                                   currency, program_revision, reward_snapshot, announce)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'earned', $14, $15, $16, $17, $18, $19, $20)
         ON CONFLICT (id) DO NOTHING RETURNING created_at`,
        [id, p.id, p.kind, args.agentId, args.userCode, args.closerName, win.key, n, n * p.salesRequired, p.amount, p.prizeLabel, p.name,
          p.salesRequired, args.saleId, args.caseId ?? null, p.rewardType, p.currency, p.revision, JSON.stringify(snap), announce],
      );
      if (ins.rowCount)
        out.push({
          id, programId: p.id, programName: p.name, kind: p.kind, rewardType: p.rewardType, amount: p.amount, currency: p.currency,
          prizeLabel: p.prizeLabel, periodKey: win.key, n, validatedCount: n * p.salesRequired, salesRequired: p.salesRequired, announce,
          createdAt: new Date(ins.rows[0].created_at).toISOString(),
        });
    }
  }
  return out;
}
