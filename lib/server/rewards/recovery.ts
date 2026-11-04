import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { arenaBroadcaster } from "../events/broadcaster";
import { calendarFrom, readArenaConfig } from "../settings/arena-config";
import { periodWindow } from "../spins/rules";
import { readSpinSettings } from "../spins/ledger";
import { publicAward } from "../sales/ingest";
import { designationOn } from "../teams/repo";
import {
  achievedTiers, audienceOk, automaticFrom, effectiveOf, evaluateTierGroup, inScope, KIND_TO_PERIOD, loadActivePrograms, loadChain, loadTierSales,
  planTierAward, tierGroups, type RewardEngineConfig,
} from "./engine";
import type { RewardProgram } from "./programs";

/**
 * Owner-only "Find missing awards" for highest-tier reward groups. Generic for every agent, group and period.
 * Never touches sales, processing flags, activation times or spin credits, and never pays anything.
 *
 * For one agent / kind / reward group / business period it computes, with the SAME rules as the live engine:
 *   - the current effective tier (if any) and the highest tier the counted sales now reach;
 *   - CATCH-UP: the higher tier is reached by sales the automatic rule counts (plus sales the Owner already
 *     approved) but the award was never created (e.g. sales stored before an engine fix, or a lower tier was
 *     recovered and the next milestone was missed);
 *   - RECOVERY: the higher tier needs sales validated before program activation, which the Owner must approve.
 *     Approved sales are recorded (bonus_sale_approvals) and count consistently for every later tier.
 * Applying runs the real engine: the new tier supersedes the previous one (2,000 → 3,000 is +1,000, never
 * 5,000), it is audited, idempotent (a second apply finds nothing to do) and limited to the approved range.
 * Additive programs are still awarded automatically by the engine; they are not part of this scan.
 */

export class RecoveryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Kind = "daily" | "weekly" | "monthly";
export type SaleClass = "counted_automatically" | "owner_approved" | "needs_approval" | "historical_import" | "outside_range";
const CLASS_LABEL: Record<SaleClass, string> = {
  counted_automatically: "Counted automatically (validated after the program was activated)",
  owner_approved: "Counted: already approved by the Owner for this period",
  needs_approval: "Validated before the program was activated: counts only if you approve it",
  historical_import: "Historical import (backfill): excluded by business rule",
  outside_range: "Validated before activation and outside the approved date range: excluded",
};
export interface GroupInput {
  userCode?: unknown;
  kind?: unknown;
  rewardGroup?: unknown;
  /** Any date inside the business period (YYYY-MM-DD, business timezone). */
  periodDate?: unknown;
  /** Owner-approved window for sales that need approval. */
  notBefore?: unknown;
  notAfter?: unknown;
  includeBackfill?: unknown;
}
type Actor = { adminId: string; ip: string | null; userAgent: string | null };
type Db = Pool | PoolClient;

const optDate = (v: unknown, label: string): Date | null => {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new RecoveryError(`${label} must be a valid date and time.`);
  return d;
};
function parse(input: GroupInput) {
  const userCode = typeof input.userCode === "string" ? input.userCode.trim().toUpperCase() : "";
  if (!userCode || userCode.length > 64) throw new RecoveryError("Choose an agent.");
  const kind = input.kind as Kind;
  if (!["daily", "weekly", "monthly"].includes(kind)) throw new RecoveryError("Choose Daily, Weekly or Monthly.");
  const rewardGroup = typeof input.rewardGroup === "string" && input.rewardGroup.trim() ? input.rewardGroup.trim().toLowerCase() : "default";
  const periodDate = typeof input.periodDate === "string" ? input.periodDate : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodDate) || Number.isNaN(Date.parse(periodDate))) throw new RecoveryError("Choose a date in the business period (YYYY-MM-DD).");
  return { userCode, kind, rewardGroup, periodDate, notBefore: optDate(input.notBefore, "The start of the range"), notAfter: optDate(input.notAfter, "The end of the range"), includeBackfill: input.includeBackfill === true };
}

function engineConfig(cfg: Record<string, unknown>): RewardEngineConfig {
  return {
    categories: cfg.rewardCategories as RewardEngineConfig["categories"],
    arenaEnabled: cfg.arenaEnabled !== false,
    celebrationPopups: cfg.celebrationPopups !== false,
    announceCash: cfg.announceCash !== false,
    announcePrizes: cfg.announcePrizes !== false,
  };
}

/** Read-only preview for one agent / kind / reward group / period. */
export async function previewGroup(db: Db, input: GroupInput) {
  const q = parse(input);
  const agent = (await db.query(`SELECT id, name, campaign_id FROM agents WHERE user_code = $1`, [q.userCode])).rows[0];
  if (!agent) throw new RecoveryError("No agent with that user code exists in PostgreSQL.", 404);
  const cfg = (await readArenaConfig(db)).values;
  const cal = calendarFrom(cfg);
  const cutoff = (await readSpinSettings(db)).activationCutoff;
  // Noon UTC on the chosen date lies on that same business date for any timezone within ±12 h.
  const at = new Date(`${q.periodDate}T12:00:00Z`);
  const win = periodWindow(KIND_TO_PERIOD[q.kind], at, cal);

  const blockers: string[] = [];
  const notes: string[] = [];
  const catActive = (cfg.rewardCategories as Record<string, { active: boolean }>)?.[q.kind]?.active !== false;
  if (!catActive) blockers.push(`The ${q.kind} category is paused (Program Active is off): nothing can be earned.`);
  const group = tierGroups(await loadActivePrograms(db, [q.kind])).find((g) => g.rewardGroup === q.rewardGroup);
  // Senior / Junior audience: the designation in force on the chosen business date.
  const designation = (group?.programs ?? []).some((p) => p.audience !== "all") ? await designationOn(db, q.userCode, q.periodDate) : null;
  const programs: RewardProgram[] = (group?.programs ?? []).filter(
    (p) => inScope(p, q.userCode, agent.campaign_id ?? null) && audienceOk(p, designation) && !(p.startDate && q.periodDate < p.startDate) && !(p.endDate && q.periodDate > p.endDate),
  );
  if ((group?.programs ?? []).some((p) => p.audience !== "all") && !designation) notes.push("This agent has no Senior / Junior designation on that date: Senior-only and Junior-only programmes do not apply.");
  if (!programs.length) blockers.push("No active highest-tier program of this group applies to this agent in this period.");

  const sales = await loadTierSales(db, q.userCode, q.kind, q.rewardGroup, win);
  const earliestAuto = programs.length ? Math.min(...programs.map((p) => automaticFrom(p, win, cutoff))) : Infinity;
  const classified = sales.map((s) => {
    const t = s.validatedAt.getTime();
    let cls: SaleClass;
    if (s.approved) cls = "owner_approved";
    else if (s.source !== "backfill" && t >= earliestAuto) cls = "counted_automatically";
    else if (s.source === "backfill" && !q.includeBackfill) cls = "historical_import";
    else if ((q.notBefore && s.validatedAt < q.notBefore) || (q.notAfter && s.validatedAt > q.notAfter)) cls = "outside_range";
    else cls = "needs_approval";
    return { saleId: s.id, caseId: s.caseId, validatedAt: s.validatedAt.toISOString(), source: s.source, class: cls, explanation: CLASS_LABEL[cls] };
  });
  const extra = new Set(classified.filter((s) => s.class === "needs_approval").map((s) => s.saleId));

  const chain = await loadChain(db, q.userCode, q.kind, q.rewardGroup, win.key);
  const caps = new Map<string, boolean>();
  for (const p of programs)
    if (p.maxTotalAwards !== null)
      caps.set(p.id, Number((await db.query(`SELECT COUNT(*)::int AS n FROM bonus_awards WHERE program_id = $1 AND period_key = $2`, [p.id, win.key])).rows[0].n) >= p.maxTotalAwards);
  const capFn = (id: string) => caps.get(id) === true;
  const planAuto = programs.length ? planTierAward(achievedTiers(programs, sales, win, cutoff), chain, q.userCode, win.key, capFn) : null;
  const planFull = programs.length ? planTierAward(achievedTiers(programs, sales, win, cutoff, extra), chain, q.userCode, win.key, capFn) : null;
  const plan = blockers.length ? null : planFull;
  const needsApproval = !!plan && (!planAuto || plan.program.salesRequired > planAuto.program.salesRequired);
  const effective = effectiveOf(chain)[0] ?? null;
  if (!plan && !blockers.length) notes.push(effective ? `The effective tier (${effective.programName}) is already the highest these sales reach.` : "The counted sales do not reach any tier.");

  return {
    agent: { userCode: q.userCode, name: String(agent.name), id: String(agent.id) },
    group: { kind: q.kind, rewardGroup: q.rewardGroup },
    period: { key: win.key, start: win.start?.toISOString() ?? null, end: win.end?.toISOString() ?? null, timezone: cal.timezone, date: q.periodDate },
    tiers: programs
      .slice()
      .sort((a, b) => a.salesRequired - b.salesRequired)
      .map((p) => ({ programId: p.id, name: p.name, salesRequired: p.salesRequired, amount: p.amount, currency: p.currency, activeSince: p.activeSince })),
    sales: classified,
    chain: chain.map((c) => ({ id: c.id, programName: c.programName, salesRequired: c.salesRequired, amount: c.amount, status: c.status, source: c.source, superseded: !!c.supersededBy })),
    effective: effective ? { id: effective.id, programName: effective.programName, salesRequired: effective.salesRequired, amount: effective.amount, status: effective.status } : null,
    proposed: plan
      ? {
          programId: plan.program.id,
          programName: plan.program.name,
          salesRequired: plan.program.salesRequired,
          amount: plan.program.amount,
          currency: plan.program.currency,
          previousAmount: plan.previousAmount,
          incrementAmount: plan.incrementAmount,
          payableAmount: plan.payableAmount,
          countedCaseIds: plan.counted.map((s) => s.caseId),
          triggerCaseId: plan.trigger.caseId,
        }
      : null,
    source: plan ? (needsApproval ? ("recovery" as const) : ("automatic" as const)) : null,
    approvalCaseIds: needsApproval ? classified.filter((s) => s.class === "needs_approval").map((s) => s.caseId) : [],
    blockers,
    notes,
    canApply: !!plan,
    _programs: programs,
    _approvalSaleIds: needsApproval ? [...extra] : [],
    _cfg: cfg,
    _cal: cal,
    _cutoff: cutoff,
    _at: at,
  };
}

/** Applies ONE previewed upgrade (Owner, audited, idempotent). */
export async function applyGroup(pool: Pool, input: GroupInput & { reason?: unknown; confirm?: unknown; announce?: unknown; expectProgramId?: unknown }, actor: Actor) {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 10 || reason.length > 500) throw new RecoveryError("Write a reason (10 to 500 characters).");
  if (input.confirm !== true) throw new RecoveryError("Confirm the approval.", 428);
  const q = parse(input);
  let agentName = "";
  const client = await pool.connect();
  let rec: Awaited<ReturnType<typeof evaluateTierGroup>> = null;
  try {
    await client.query("BEGIN");
    // Same lock as the automatic engine: never interleaves with live sales for this agent.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bonus:' || $1))`, [q.userCode]);
    const pv = await previewGroup(client, input);
    agentName = pv.agent.name;
    if (!pv.proposed) throw new RecoveryError(`Nothing to apply. ${[...pv.blockers, ...pv.notes].join(" ")}`.trim(), 409);
    if (input.expectProgramId !== undefined && input.expectProgramId !== pv.proposed.programId)
      throw new RecoveryError("The proposal changed since the preview (new sales or awards). Review it again.", 409);
    for (const saleId of pv._approvalSaleIds)
      await client.query(
        `INSERT INTO bonus_sale_approvals (sale_id, user_code, kind, reward_group, period_key, reason, approved_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [saleId, q.userCode, q.kind, q.rewardGroup, pv.period.key, reason, actor.adminId],
      );
    rec = await evaluateTierGroup(client, {
      userCode: q.userCode,
      agentId: pv.agent.id,
      closerName: pv.agent.name,
      kind: q.kind,
      rewardGroup: q.rewardGroup,
      programs: pv._programs,
      at: pv._at,
      calendar: pv._cal,
      cutoff: pv._cutoff,
      config: engineConfig(pv._cfg),
      approval: { adminId: actor.adminId, reason, source: pv.source!, announce: input.announce !== false },
    });
    if (!rec || rec.programId !== pv.proposed.programId) throw new RecoveryError("The proposal could not be applied (it changed). Review it again.", 409);
    if (pv._approvalSaleIds.length)
      await client.query(`UPDATE bonus_sale_approvals SET source_award_id = $1 WHERE sale_id = ANY($2) AND kind = $3 AND reward_group = $4 AND period_key = $5 AND source_award_id IS NULL`, [
        rec.id, pv._approvalSaleIds, q.kind, q.rewardGroup, pv.period.key,
      ]);
    await writeAudit(client, {
      adminId: actor.adminId,
      action: pv.source === "recovery" ? "bonus_award.recovered" : "bonus_award.catch_up",
      targetType: "bonus_award",
      targetId: rec.id,
      details: {
        reason,
        userCode: q.userCode,
        kind: q.kind,
        rewardGroup: q.rewardGroup,
        periodKey: pv.period.key,
        from: pv.effective ? { awardId: pv.effective.id, program: pv.effective.programName, amount: pv.effective.amount } : null,
        to: { awardId: rec.id, program: rec.programName, amount: rec.amount, currency: rec.currency },
        incrementAmount: rec.incrementAmount,
        payableAmount: rec.payableAmount,
        salesCounted: pv.proposed.countedCaseIds,
        approvedSales: pv.approvalCaseIds,
      },
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
  // Only after commit: every screen updates (leaderboard, podium, Award History; popup if allowed).
  const r = rec!;
  arenaBroadcaster.broadcast("rewards.award.created", { award: publicAward(r, q.userCode, agentName) });
  return { created: { id: r.id, programName: r.programName, amount: r.amount, currency: r.currency, previousAmount: r.previousAmount, incrementAmount: r.incrementAmount, payableAmount: r.payableAmount, upgrade: r.upgrade } };
}

/**
 * Read-only scan of an Owner-chosen business date range: every agent with validated sales in the range ×
 * every highest-tier group × every period touched. Lists only real upgrades (never a lower tier than the
 * one already effective). Nothing is written.
 */
export async function scanRecovery(db: Db, input: { from?: unknown; to?: unknown; includeBackfill?: unknown; audience?: unknown }) {
  // Senior = Senior-only and all-agent programmes (the existing ones); Junior = Junior programmes only.
  const audience = input.audience === "senior" || input.audience === "junior" ? input.audience : "all";
  const from = typeof input.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? input.from : "";
  const to = typeof input.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? input.to : "";
  if (!from || !to || to < from) throw new RecoveryError("Choose a valid date range (from ≤ to).");
  if (Date.parse(to) - Date.parse(from) > 62 * 86400_000) throw new RecoveryError("Scan at most about two months at a time.");
  const cfg = (await readArenaConfig(db)).values;
  const cal = calendarFrom(cfg);
  const start = periodWindow("daily", new Date(`${from}T12:00:00Z`), cal).start!;
  const end = periodWindow("daily", new Date(`${to}T12:00:00Z`), cal).end!;
  const notBefore = start.toISOString();
  const notAfter = new Date(end.getTime() - 1).toISOString();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: cal.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const sales = (await db.query(`SELECT user_code, validated_at FROM validated_sales WHERE status = 'validated' AND validated_at >= $1 AND validated_at < $2`, [start, end])).rows;
  const days = new Map<string, Set<string>>();
  for (const s of sales) days.set(s.user_code, (days.get(s.user_code) ?? new Set()).add(fmt.format(new Date(s.validated_at))));
  const groups = tierGroups(await loadActivePrograms(db, ["daily", "weekly", "monthly"])).filter((g) =>
    audience === "all" ? true : audience === "junior" ? g.programs.some((p) => p.audience === "junior") : g.programs.some((p) => p.audience !== "junior"),
  );
  const items = [];
  const periodCounts = new Map<string, Map<string, number>>(); // kind|periodKey → user → validated count in the whole period
  for (const g of groups) {
    const minTier = Math.min(...g.programs.map((p) => p.salesRequired));
    for (const [userCode, ds] of days) {
      const seen = new Set<string>();
      for (const day of ds) {
        const win = periodWindow(KIND_TO_PERIOD[g.kind], new Date(`${day}T12:00:00Z`), cal);
        if (seen.has(win.key)) continue;
        seen.add(win.key);
        const ck = `${g.kind}|${win.key}`;
        if (!periodCounts.has(ck)) {
          const rows = (await db.query(`SELECT user_code, COUNT(*)::int AS n FROM validated_sales WHERE status = 'validated' AND validated_at >= $1 AND validated_at < $2 GROUP BY user_code`, [win.start, win.end])).rows;
          periodCounts.set(ck, new Map(rows.map((r) => [r.user_code, r.n])));
        }
        if ((periodCounts.get(ck)!.get(userCode) ?? 0) < minTier) continue; // cannot reach any tier
        const pv = await previewGroup(db, { userCode, kind: g.kind, rewardGroup: g.rewardGroup, periodDate: day, notBefore, notAfter, includeBackfill: input.includeBackfill === true });
        if (!pv.proposed) continue;
        items.push({
          userCode,
          agentName: pv.agent.name,
          kind: g.kind,
          rewardGroup: g.rewardGroup,
          audience: g.programs.some((p) => p.audience === "junior") ? "junior" : "senior",
          periodKey: pv.period.key,
          periodDate: day,
          existing: pv.effective,
          proposed: pv.proposed,
          source: pv.source,
          approvalCaseIds: pv.approvalCaseIds,
          excluded: pv.sales.filter((s) => s.class === "historical_import" || s.class === "outside_range").map((s) => ({ caseId: s.caseId, reason: s.explanation })),
        });
      }
    }
  }
  return { range: { from, to, notBefore, notAfter, timezone: cal.timezone }, audience, programGroups: groups.length, agents: days.size, sales: sales.length, items };
}

/** Public preview (internal fields removed). */
export function previewView(pv: Awaited<ReturnType<typeof previewGroup>>) {
  const { _programs: _p, _approvalSaleIds: _a, _cfg: _c, _cal: _k, _cutoff: _x, _at: _t, ...rest } = pv;
  return rest;
}
