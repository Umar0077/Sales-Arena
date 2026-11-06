import type { PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { periodWindow, type BusinessCalendar, type PeriodWindow, type RulePeriod } from "../spins/rules";
import { COLS, duplicateProgramIds, rowToProgram, type RewardProgram } from "./programs";
import { designationOn } from "../teams/repo";

/**
 * Daily / weekly / monthly bonus engine (server side). Programs come only from reward_programs.
 *
 * HIGHEST TIER (tier_policy = 'highest_tier', cash): programs of the same kind + reward_group compete.
 * For each agent and business period only the HIGHEST achieved milestone is the effective bonus.
 * Reaching a higher tier creates the new award and SUPERSEDES the previous effective one (kept, marked,
 * audited): 2 sales → 2,000; 3 sales → 3,000 total (+1,000), never 5,000. Skipped tiers jump straight to
 * the highest achieved one. A tier is awarded at most once per period; a cancelled tier is never re-issued.
 *
 * A sale counts for a program when it is validated, inside the business period and either
 *   - live (not a historical import) and validated at/after max(period start, program activation, spin
 *     cutoff if set), or
 *   - explicitly approved by the Owner for this kind / group / period (bonus_sale_approvals).
 *
 * Payment accounting per period chain: the new award's payable_amount = its amount − cash already paid on
 * earlier tiers; an unpaid superseded award pays 0 (its value is folded into the new one); a paid one keeps
 * what it paid. Nothing is paid automatically.
 *
 * ADDITIVE programs (tier_policy = 'additive', and all non-cash rewards) keep the previous behaviour:
 * each pays independently, up to maxAwards per period.
 *
 * Runs inside the transaction that stored the sale (atomic: if anything fails, the sale is not stored and
 * the next delivery retries everything). Award ids are deterministic and unique, and a per-agent advisory
 * lock plus a unique index (one effective tier per agent/group/period) make concurrent delivery safe.
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
  /** Tier upgrades: the previous effective entitlement and the increase. */
  upgrade: boolean;
  previousAmount: number;
  incrementAmount: number;
  payableAmount: number;
  supersedesId: string | null;
}

export interface RewardEngineConfig {
  categories: Record<string, { active: boolean; showOnArena: boolean }>;
  arenaEnabled: boolean;
  celebrationPopups: boolean;
  announceCash: boolean;
  announcePrizes: boolean;
}

export const KIND_TO_PERIOD: Record<string, RulePeriod> = { daily: "daily", weekly: "weekly", monthly: "monthly" };

function ymdInZone(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Senior / Junior audience: "all" programmes apply to everyone (the behaviour before designations); a
 * "senior" or "junior" programme only to an agent with that designation on the sale's business date. An
 * agent without a designation never qualifies for a Senior-only or Junior-only programme.
 */
export function audienceOk(p: Pick<RewardProgram, "audience">, designation: "senior" | "junior" | null): boolean {
  return !p.audience || p.audience === "all" || p.audience === designation;
}

export function inScope(p: RewardProgram, userCode: string, campaignId: string | null): boolean {
  if (p.scopeType === "agents") return p.scopeIds.includes(userCode);
  if (p.scopeType === "campaign") return !!campaignId && p.scopeIds.includes(campaignId);
  return true;
}

// ------------------------------------------------------------------ shared tier calculation

export interface TierSale {
  id: string;
  caseId: string;
  validatedAt: Date;
  source: string;
  approved: boolean;
}

/** Sales of one agent in one period, with whether the Owner approved each for this kind / group. */
export async function loadTierSales(client: PoolClient | { query: PoolClient["query"] }, userCode: string, kind: string, group: string, win: PeriodWindow): Promise<TierSale[]> {
  const { rows } = await client.query(
    `SELECT s.id, s.case_id, s.validated_at, s.source, (ap.id IS NOT NULL) AS approved
       FROM validated_sales s
       LEFT JOIN bonus_sale_approvals ap ON ap.sale_id = s.id AND ap.kind = $2 AND ap.reward_group = $3 AND ap.period_key = $4
      WHERE s.user_code = $1 AND s.status = 'validated' AND s.validated_at >= $5 AND s.validated_at < $6
      ORDER BY s.validated_at, s.id`,
    [userCode, kind, group, win.key, win.start, win.end],
  );
  return rows.map((r) => ({ id: String(r.id), caseId: String(r.case_id), validatedAt: new Date(r.validated_at), source: String(r.source), approved: Boolean(r.approved) }));
}

/** When the automatic rule starts counting for a program in this period. */
export function automaticFrom(p: RewardProgram, win: PeriodWindow, cutoff: Date | null): number {
  return Math.max(win.start?.getTime() ?? 0, cutoff?.getTime() ?? 0, p.activeSince ? new Date(p.activeSince).getTime() : 0);
}

/** Sales that count for program p: Owner-approved, extra (preview of a proposed approval), or automatic. */
export function countedFor(p: RewardProgram, sales: TierSale[], win: PeriodWindow, cutoff: Date | null, extra?: Set<string>): TierSale[] {
  const from = automaticFrom(p, win, cutoff);
  return sales.filter((s) => s.approved || extra?.has(s.id) || (s.source !== "backfill" && s.validatedAt.getTime() >= from));
}

/** Achieved tiers, highest first (by milestone, then amount, then oldest program). */
export function achievedTiers(programs: RewardProgram[], sales: TierSale[], win: PeriodWindow, cutoff: Date | null, extra?: Set<string>) {
  return programs
    .map((p) => ({ program: p, counted: countedFor(p, sales, win, cutoff, extra) }))
    .filter((t) => t.counted.length >= t.program.salesRequired)
    .sort((a, b) => b.program.salesRequired - a.program.salesRequired || b.program.amount - a.program.amount || a.program.createdAt.localeCompare(b.program.createdAt));
}

export interface ChainAward {
  id: string;
  programId: string;
  programName: string;
  salesRequired: number;
  amount: number;
  status: string;
  payableAmount: number;
  supersededBy: string | null;
  source: string;
}
export async function loadChain(client: PoolClient | { query: PoolClient["query"] }, userCode: string, kind: string, group: string, periodKey: string, lock = false): Promise<ChainAward[]> {
  const { rows } = await client.query(
    `SELECT id, program_id, program_name, sales_required, amount, status, payable_amount, superseded_by, source FROM bonus_awards
      WHERE user_code = $1 AND kind = $2 AND reward_group = $3 AND period_key = $4 AND tier_policy = 'highest_tier' AND reward_type = 'cash'
      ORDER BY sales_required, created_at${lock ? " FOR UPDATE" : ""}`,
    [userCode, kind, group, periodKey],
  );
  return rows.map((r) => ({
    id: String(r.id), programId: String(r.program_id), programName: String(r.program_name), salesRequired: Number(r.sales_required), amount: Number(r.amount),
    status: String(r.status), payableAmount: Number(r.payable_amount), supersededBy: (r.superseded_by as string) ?? null, source: String(r.source ?? "automatic"),
  }));
}
export const effectiveOf = (chain: ChainAward[]) => chain.filter((c) => !c.supersededBy && c.status !== "cancelled" && c.status !== "reversed");

/**
 * Decide the award a tier group should get now (pure). Returns null when nothing changes:
 * no tier achieved, the effective award is already at least that tier, the tier was already issued once
 * (even if cancelled), it would not increase the entitlement, or the program's total cap is reached.
 */
export function planTierAward(
  achieved: ReturnType<typeof achievedTiers>,
  chain: ChainAward[],
  userCode: string,
  periodKey: string,
  capReached: (programId: string) => boolean,
) {
  const effective = effectiveOf(chain);
  const effectiveTier = effective.reduce((m, c) => Math.max(m, c.salesRequired), 0);
  const previousAmount = effective.reduce((t, c) => t + c.amount, 0);
  for (const t of achieved) {
    const p = t.program;
    const id = `${p.id}:${userCode}:${periodKey}:1`;
    if (p.salesRequired <= effectiveTier) return null; // already at (or above) this milestone
    if (chain.some((c) => c.id === id)) continue; // issued before (possibly cancelled): never re-issued
    if (p.amount <= previousAmount) return null; // never reduce or duplicate an entitlement
    if (capReached(p.id)) continue;
    const paidSoFar = chain.filter((c) => c.status === "paid").reduce((s, c) => s + c.payableAmount, 0);
    return {
      id,
      program: p,
      counted: t.counted,
      trigger: t.counted[p.salesRequired - 1],
      effective,
      previousAmount,
      incrementAmount: p.amount - previousAmount,
      payableAmount: Math.max(0, p.amount - paidSoFar),
    };
  }
  return null;
}

export interface TierGroupArgs {
  userCode: string;
  agentId: string;
  closerName: string;
  kind: "daily" | "weekly" | "monthly";
  rewardGroup: string;
  programs: RewardProgram[];
  /** Any instant inside the business period. */
  at: Date;
  calendar: BusinessCalendar;
  cutoff: Date | null;
  config: RewardEngineConfig;
  /** Owner-approved catch-up / recovery (recorded on the award). */
  approval?: { adminId: string; reason: string; source: "automatic" | "recovery"; announce: boolean };
}

/** Evaluates one highest-tier group for one agent and period, creating the upgrade if one is due. */
export async function evaluateTierGroup(client: PoolClient, a: TierGroupArgs): Promise<BonusAwardRecord | null> {
  const win = periodWindow(KIND_TO_PERIOD[a.kind], a.at, a.calendar);
  const sales = await loadTierSales(client, a.userCode, a.kind, a.rewardGroup, win);
  const achieved = achievedTiers(a.programs, sales, win, a.cutoff);
  if (!achieved.length) return null;
  const chain = await loadChain(client, a.userCode, a.kind, a.rewardGroup, win.key, true);
  const caps = new Map<string, boolean>();
  for (const t of achieved) {
    if (t.program.maxTotalAwards === null) continue;
    await client.query(`SELECT 1 FROM reward_programs WHERE id = $1 FOR UPDATE`, [t.program.id]); // serialise the shared cap
    const total = Number((await client.query(`SELECT COUNT(*)::int AS n FROM bonus_awards WHERE program_id = $1 AND period_key = $2`, [t.program.id, win.key])).rows[0].n);
    caps.set(t.program.id, total >= t.program.maxTotalAwards);
  }
  const plan = planTierAward(achieved, chain, a.userCode, win.key, (id) => caps.get(id) === true);
  if (!plan) return null;
  const p = plan.program;

  const cat = a.config.categories[p.kind];
  const announce =
    (a.approval ? a.approval.announce : true) && a.config.arenaEnabled && a.config.celebrationPopups && !!cat?.showOnArena && p.showOnArena && a.config.announceCash;
  const snap = { name: p.name, rewardType: p.rewardType, amount: p.amount, currency: p.currency, prizeLabel: p.prizeLabel, salesRequired: p.salesRequired, description: p.description, revision: p.revision, tierPolicy: p.tierPolicy, rewardGroup: p.rewardGroup };

  // 1) Supersede the current effective award(s): kept for history; unpaid ones fold into the new award.
  for (const e of plan.effective) {
    await client.query(
      `UPDATE bonus_awards SET superseded_by = $2, superseded_at = NOW(), payable_amount = CASE WHEN status = 'paid' THEN payable_amount ELSE 0 END WHERE id = $1`,
      [e.id, plan.id],
    );
    await writeAudit(client, {
      adminId: a.approval?.adminId ?? null,
      action: "bonus_award.superseded",
      targetType: "bonus_award",
      targetId: e.id,
      details: {
        supersededBy: plan.id,
        from: { program: e.programName, salesRequired: e.salesRequired, amount: e.amount, status: e.status },
        to: { program: p.name, salesRequired: p.salesRequired, amount: p.amount },
        incrementAmount: plan.incrementAmount,
        payableAmount: plan.payableAmount,
        alreadyPaid: e.status === "paid",
      },
    });
  }
  // 2) The new highest-tier award.
  const ins = await client.query(
    `INSERT INTO bonus_awards (id, program_id, kind, agent_id, user_code, agent_name, period_key, n, validated_at_award, amount, prize_label,
                               program_name, sales_required, status, trigger_sale_id, trigger_case_id, reward_type, currency, program_revision,
                               reward_snapshot, announce, tier_policy, reward_group, supersedes_id, previous_amount, increment_amount, payable_amount,
                               source, recovery_reason, recovered_by, recovered_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, '', $10, $11, 'earned', $12, $13, 'cash', $14, $15, $16, $17, 'highest_tier', $18, $19, $20, $21, $22,
             $23, $24, $25, CASE WHEN $25::uuid IS NULL THEN NULL ELSE NOW() END)
     ON CONFLICT (id) DO NOTHING RETURNING created_at`,
    [plan.id, p.id, p.kind, a.agentId, a.userCode, a.closerName, win.key, p.salesRequired, p.amount, p.name, p.salesRequired,
      plan.trigger.id, plan.trigger.caseId, p.currency, p.revision, JSON.stringify(snap), announce, p.rewardGroup, plan.effective[0]?.id ?? null,
      plan.previousAmount, plan.incrementAmount, plan.payableAmount, a.approval?.source ?? "automatic", a.approval?.reason ?? null, a.approval?.adminId ?? null],
  );
  if (!ins.rowCount) throw new Error(`Tier award ${plan.id} could not be created.`); // rolls back the supersession too
  return {
    id: plan.id, programId: p.id, programName: p.name, kind: p.kind, rewardType: "cash", amount: p.amount, currency: p.currency, prizeLabel: "",
    periodKey: win.key, n: 1, validatedCount: p.salesRequired, salesRequired: p.salesRequired, announce, createdAt: new Date(ins.rows[0].created_at).toISOString(),
    upgrade: plan.effective.length > 0, previousAmount: plan.previousAmount, incrementAmount: plan.incrementAmount, payableAmount: plan.payableAmount,
    supersedesId: plan.effective[0]?.id ?? null,
  };
}

/** Active, non-duplicate programs for these kinds (shared by the engine and the Owner scan). */
export async function loadActivePrograms(client: PoolClient | { query: PoolClient["query"] }, kinds: string[]): Promise<RewardProgram[]> {
  const programs = (await client.query(`SELECT ${COLS} FROM reward_programs WHERE enabled AND archived_at IS NULL AND kind = ANY($1) ORDER BY stackable, sales_required DESC, id`, [kinds])).rows.map((r) => rowToProgram(r));
  // Duplicate protection: identical active programs would pay the same milestone twice; only the oldest counts.
  const dupes = duplicateProgramIds(programs);
  return programs.filter((p) => !dupes.has(p.id));
}

/** Highest-tier groups (cash, tier_policy highest_tier) keyed by kind + reward group. */
export function tierGroups(programs: RewardProgram[]) {
  const groups = new Map<string, { kind: RewardProgram["kind"]; rewardGroup: string; programs: RewardProgram[] }>();
  for (const p of programs) {
    if (p.rewardType !== "cash" || p.tierPolicy !== "highest_tier") continue;
    const k = `${p.kind}|${p.rewardGroup}`;
    const g = groups.get(k) ?? { kind: p.kind, rewardGroup: p.rewardGroup, programs: [] };
    g.programs.push(p);
    groups.set(k, g);
  }
  return [...groups.values()];
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
  },
): Promise<BonusAwardRecord[]> {
  // One evaluation per agent at a time: a second concurrent sale waits here, then sees the first one.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('bonus:' || $1))`, [args.userCode]);

  const activeKinds = Object.entries(args.config.categories).filter(([, c]) => c.active).map(([k]) => k);
  if (!activeKinds.length) return [];
  const all = await loadActivePrograms(client, activeKinds);
  if (!all.length) return [];
  const campaignId = ((await client.query(`SELECT campaign_id FROM agents WHERE user_code = $1`, [args.userCode])).rows[0]?.campaign_id as string | null) ?? null;
  const saleDay = ymdInZone(args.validatedAt, args.calendar.timezone);
  const designation = all.some((p) => p.audience && p.audience !== "all") ? await designationOn(client, args.userCode, saleDay) : null;
  const eligible = all.filter(
    (p) => !(p.startDate && saleDay < p.startDate) && !(p.endDate && saleDay > p.endDate) && inScope(p, args.userCode, campaignId) && audienceOk(p, designation),
  );
  const out: BonusAwardRecord[] = [];

  // Highest-tier groups.
  for (const g of tierGroups(eligible)) {
    const rec = await evaluateTierGroup(client, { ...args, kind: g.kind, rewardGroup: g.rewardGroup, programs: g.programs, at: args.validatedAt });
    if (rec) out.push(rec);
  }

  // Additive programs (independent; previous behaviour).
  const countCache = new Map<string, number>();
  for (const p of eligible.filter((x) => !(x.rewardType === "cash" && x.tierPolicy === "highest_tier"))) {
    const period = KIND_TO_PERIOD[p.kind];
    if (!period) continue;
    // A sale validated before the program was (re)activated never counts for it.
    if (p.activeSince && args.validatedAt.getTime() < new Date(p.activeSince).getTime()) continue;
    const win = periodWindow(period, args.validatedAt, args.calendar);
    const from = new Date(automaticFrom(p, win, args.cutoff));
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
      await client.query(`SELECT 1 FROM reward_programs WHERE id = $1 FOR UPDATE`, [p.id]);
      const total = (await client.query(`SELECT COUNT(*)::int AS n FROM bonus_awards WHERE program_id = $1 AND period_key = $2`, [p.id, win.key])).rows[0].n as number;
      room = Math.min(room, Math.max(0, p.maxTotalAwards - total));
    }
    const cat = args.config.categories[p.kind];
    const cash = p.rewardType === "cash";
    const announce = args.config.arenaEnabled && args.config.celebrationPopups && !!cat?.showOnArena && p.showOnArena && (cash ? args.config.announceCash : args.config.announcePrizes);
    const snap = { name: p.name, rewardType: p.rewardType, amount: p.amount, currency: p.currency, prizeLabel: p.prizeLabel, salesRequired: p.salesRequired, description: p.description, revision: p.revision, tierPolicy: p.tierPolicy };
    for (let n = have + 1; n <= have + room; n++) {
      const id = `${p.id}:${args.userCode}:${win.key}:${n}`;
      const ins = await client.query(
        `INSERT INTO bonus_awards (id, program_id, kind, agent_id, user_code, agent_name, period_key, n, validated_at_award, amount,
                                   prize_label, program_name, sales_required, status, trigger_sale_id, trigger_case_id, reward_type,
                                   currency, program_revision, reward_snapshot, announce, tier_policy, reward_group, increment_amount, payable_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'earned', $14, $15, $16, $17, $18, $19, $20, 'additive', $21, $10, $10)
         ON CONFLICT (id) DO NOTHING RETURNING created_at`,
        [id, p.id, p.kind, args.agentId, args.userCode, args.closerName, win.key, n, n * p.salesRequired, p.amount, p.prizeLabel, p.name,
          p.salesRequired, args.saleId, args.caseId ?? null, p.rewardType, p.currency, p.revision, JSON.stringify(snap), announce, p.rewardGroup],
      );
      if (ins.rowCount)
        out.push({
          id, programId: p.id, programName: p.name, kind: p.kind, rewardType: p.rewardType, amount: p.amount, currency: p.currency,
          prizeLabel: p.prizeLabel, periodKey: win.key, n, validatedCount: n * p.salesRequired, salesRequired: p.salesRequired, announce,
          createdAt: new Date(ins.rows[0].created_at).toISOString(), upgrade: false, previousAmount: 0, incrementAmount: p.amount, payableAmount: p.amount, supersedesId: null,
        });
    }
  }
  return out;
}
