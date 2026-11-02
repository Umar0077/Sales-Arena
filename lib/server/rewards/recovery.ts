import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { arenaBroadcaster } from "../events/broadcaster";
import { calendarFrom, readArenaConfig } from "../settings/arena-config";
import { periodWindow, type RulePeriod } from "../spins/rules";
import { readSpinSettings } from "../spins/ledger";
import { publicAward } from "../sales/ingest";
import { duplicateProgramIds, listPrograms, rowToProgram, type RewardProgram } from "./programs";
import { evaluateBonusAwards, type BonusAwardRecord } from "./engine";

/**
 * Owner-approved recovery of bonuses that were genuinely earned but never issued. Generic for any agent,
 * program and business period; never touches sales, processing flags, activation times or spin credits.
 *
 * Two kinds of missing award, kept strictly apart so nothing can be paid twice:
 *  - CATCH-UP: sales the current automatic rule counts (live, validated, after program activation) whose
 *    award was never issued, e.g. because bonuses used to require the spin activation cutoff. Applying it
 *    runs the real reward engine once for the selected program and period.
 *  - RECOVERY: sales the automatic rule never counts (validated before the program's activation or before
 *    the cutoff). Applying it creates the missing award(s) with source = 'recovery' (the engine treats these
 *    as already-earned, so the same sales are never counted again).
 * Both use the engine's per-agent lock and deterministic award ids: repeating either creates nothing.
 * Awards are created as "earned" (never "paid"), with the reason and approving Owner recorded.
 */

export class RecoveryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type SaleClass = "recoverable" | "counted_automatically" | "historical_import" | "not_validated" | "outside_range";
export interface RecoveryInput {
  userCode?: unknown;
  programId?: unknown;
  /** Any date inside the business period (YYYY-MM-DD, business timezone). */
  periodDate?: unknown;
  /** Owner-approved window: only sales validated inside [notBefore, notAfter] count. */
  notBefore?: unknown;
  notAfter?: unknown;
  /** Count historical-import (backfill) sales too. Off by default: imports are excluded by business rule. */
  includeBackfill?: unknown;
}
type Actor = { adminId: string; ip: string | null; userAgent: string | null };

const KIND_TO_PERIOD: Record<string, RulePeriod> = { daily: "daily", weekly: "weekly", monthly: "monthly" };
const CLASS_LABEL: Record<SaleClass, string> = {
  recoverable: "Recoverable: validated before the program was active (or before the automatic-reward cutoff), so never counted automatically",
  counted_automatically: "Counted by the automatic rule (validated after the program was activated)",
  historical_import: "Historical import (backfill): excluded by business rule",
  not_validated: "Not validated (returned / rejected)",
  outside_range: "Outside the approved date range",
};

function inScope(p: RewardProgram, userCode: string, campaignId: string | null) {
  if (p.scopeType === "agents") return p.scopeIds.includes(userCode);
  if (p.scopeType === "campaign") return !!campaignId && p.scopeIds.includes(campaignId);
  return true;
}
const optDate = (v: unknown, label: string): Date | null => {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new RecoveryError(`${label} must be a valid date and time.`);
  return d;
};

function parse(input: RecoveryInput) {
  const userCode = typeof input.userCode === "string" ? input.userCode.trim().toUpperCase() : "";
  if (!userCode || userCode.length > 64) throw new RecoveryError("Choose an agent.");
  const programId = typeof input.programId === "string" ? input.programId.trim() : "";
  if (!programId) throw new RecoveryError("Choose a reward program.");
  const periodDate = typeof input.periodDate === "string" ? input.periodDate : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodDate) || Number.isNaN(Date.parse(periodDate))) throw new RecoveryError("Choose a date in the business period (YYYY-MM-DD).");
  return { userCode, programId, periodDate, notBefore: optDate(input.notBefore, "The start of the range"), notAfter: optDate(input.notAfter, "The end of the range"), includeBackfill: input.includeBackfill === true };
}

export async function previewRecovery(db: Pool | PoolClient, input: RecoveryInput) {
  const q = parse(input);
  const agent = (await db.query(`SELECT name, campaign_id FROM agents WHERE user_code = $1`, [q.userCode])).rows[0];
  if (!agent) throw new RecoveryError("No agent with that user code exists in PostgreSQL.", 404);
  const row = (
    await db.query(
      `SELECT id, kind, name, description, reward_type, amount, currency, prize_label, sales_required, max_awards, max_total_awards,
              to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, scope_type, scope_ids,
              stackable, enabled, show_on_arena, headline, message, reward_line, sound, accent, popup_seconds, leaderboard_count,
              active_since, archived_at, revision, created_at, updated_at
         FROM reward_programs WHERE id = $1`,
      [q.programId],
    )
  ).rows[0];
  if (!row) throw new RecoveryError("Reward program not found.", 404);
  const p = rowToProgram(row);
  const cfgValues = (await readArenaConfig(db)).values;
  const cal = calendarFrom(cfgValues);
  // Noon UTC on the chosen date lies on that same business date for any timezone within ±12 h.
  const win = periodWindow(KIND_TO_PERIOD[p.kind], new Date(`${q.periodDate}T12:00:00Z`), cal);
  const spin = await readSpinSettings(db);

  const blockers: string[] = [];
  const notes: string[] = [];
  if (p.archivedAt) blockers.push("This program is archived.");
  if (!p.enabled) notes.push("This program is paused now.");
  if (!inScope(p, q.userCode, agent.campaign_id ?? null)) blockers.push("This agent is not eligible for this program (eligibility scope).");
  if ((p.startDate && q.periodDate < p.startDate) || (p.endDate && q.periodDate > p.endDate)) blockers.push(`The chosen period (${win.key}) is outside the program's dates.`);
  if (duplicateProgramIds(await listPrograms(db)).has(p.id)) blockers.push("This program duplicates an older active program with the same milestone; use the older program.");

  // The automatic rule (engine.ts): live (non-backfill) validated sales from max(period start, cutoff, activation).
  const activeSince = p.activeSince ? new Date(p.activeSince).getTime() : 0;
  const engineFrom = Math.max(win.start?.getTime() ?? 0, spin.activationCutoff?.getTime() ?? 0, activeSince);
  const all = (
    await db.query(
      `SELECT id, case_id, closer_name, validated_at, source, reward_eligible, status FROM validated_sales
        WHERE user_code = $1 AND validated_at >= $2 AND validated_at < $3 ORDER BY validated_at, id`,
      [q.userCode, win.start, win.end],
    )
  ).rows.map((s) => {
    const at = new Date(s.validated_at);
    const automatic = s.status === "validated" && s.source !== "backfill" && at.getTime() >= engineFrom;
    let cls: SaleClass;
    if (s.status !== "validated") cls = "not_validated";
    else if ((q.notBefore && at < q.notBefore) || (q.notAfter && at > q.notAfter)) cls = "outside_range";
    else if (automatic) cls = "counted_automatically";
    else if (s.source === "backfill" && !q.includeBackfill) cls = "historical_import";
    else cls = "recoverable";
    return { saleId: String(s.id), caseId: String(s.case_id), closerName: s.closer_name as string | null, validatedAt: at.toISOString(), source: String(s.source), rewardEligible: Boolean(s.reward_eligible), automatic, class: cls, explanation: CLASS_LABEL[cls] };
  });
  const recoverable = all.filter((s) => s.class === "recoverable");
  const counted = all.filter((s) => s.class === "counted_automatically");

  const existing = (
    await db.query(`SELECT id, n, status, source, amount, created_at FROM bonus_awards WHERE program_id = $1 AND user_code = $2 AND period_key = $3 ORDER BY n`, [p.id, q.userCode, win.key])
  ).rows.map((a) => ({ id: String(a.id), n: Number(a.n), status: String(a.status), source: String(a.source ?? "automatic"), amount: Number(a.amount), createdAt: new Date(a.created_at).toISOString() }));
  const have = existing.reduce((m, a) => Math.max(m, a.n), 0);
  const recoveredBefore = existing.filter((a) => a.source === "recovery").length;
  const prior = existing.filter((a) => a.source === "recovery" || (activeSince && new Date(a.createdAt).getTime() < activeSince)).length;

  let totalRoom = Infinity;
  if (p.maxTotalAwards !== null) {
    const total = Number((await db.query(`SELECT COUNT(*)::int AS n FROM bonus_awards WHERE program_id = $1 AND period_key = $2`, [p.id, win.key])).rows[0].n);
    totalRoom = Math.max(0, p.maxTotalAwards - total);
  }
  if (!p.stackable) {
    const other = Number(
      (await db.query(`SELECT COUNT(*)::int AS n FROM bonus_awards WHERE kind = $1 AND user_code = $2 AND period_key = $3 AND program_id <> $4 AND status NOT IN ('reversed', 'cancelled')`, [p.kind, q.userCode, win.key, p.id])).rows[0].n,
    );
    if (other > 0) blockers.push("This program is not stackable and the agent already has another award in this category and period.");
  }

  // RECOVERY: milestones reached by sales the automatic rule never counts.
  const target = Math.floor(recoverable.length / p.salesRequired);
  let count = Math.max(0, Math.min(target - recoveredBefore, p.maxAwards - have, totalRoom));
  if (blockers.length) count = 0;
  const toCreate = Array.from({ length: count }, (_, i) => {
    const k = recoveredBefore + i + 1;
    const trigger = recoverable[k * p.salesRequired - 1];
    return { id: `${p.id}:${q.userCode}:${win.key}:${have + i + 1}`, n: have + i + 1, rewardType: p.rewardType, amount: p.amount, currency: p.currency, prizeLabel: p.prizeLabel, salesAtAward: p.salesRequired, triggerCaseId: trigger.caseId, triggerSaleId: trigger.saleId };
  });

  // CATCH-UP: awards the automatic rule says are due for counted sales but that were never issued.
  // The engine counts every automatic sale in the period, so it is only offered when all of them are
  // inside the approved range (otherwise sales outside the range could earn an award).
  const automaticOutside = all.filter((s) => s.automatic && s.class === "outside_range").length;
  const due = Math.max(0, Math.min(p.maxAwards, prior + count + Math.floor(counted.length / p.salesRequired)) - (have + count));
  const catchUp = {
    due: blockers.length ? 0 : Math.min(due, totalRoom),
    blocked: (automaticOutside > 0 ? "Some automatically counted sales in this period are outside the approved range; catch-up is not available for this period." : null) as string | null,
    latestSale: counted.at(-1) ?? null,
    amount: p.amount,
    currency: p.currency,
  };
  const catActive = (cfgValues.rewardCategories as Record<string, { active: boolean }>)?.[p.kind]?.active !== false;
  if (!catActive) catchUp.blocked = `The ${p.kind} category is paused (Program Active is off), so the automatic rule awards nothing.`;
  if (!p.enabled) catchUp.blocked = catchUp.blocked ?? "This program is paused, so the automatic rule awards nothing.";
  if (catchUp.blocked) catchUp.due = 0;

  if (target > 0 && recoveredBefore >= target) notes.push("The recoverable sales in this period were already recovered.");
  if (recoverable.length && recoverable.length < p.salesRequired) notes.push(`Only ${recoverable.length} recoverable sale(s); the program needs ${p.salesRequired}.`);

  return {
    agent: { userCode: q.userCode, name: String(agent.name) },
    program: { id: p.id, name: p.name, kind: p.kind, rewardType: p.rewardType, amount: p.amount, currency: p.currency, prizeLabel: p.prizeLabel, salesRequired: p.salesRequired, stackable: p.stackable, enabled: p.enabled, activeSince: p.activeSince, revision: p.revision },
    period: { key: win.key, start: win.start?.toISOString() ?? null, end: win.end?.toISOString() ?? null, timezone: cal.timezone },
    automaticCountingFrom: new Date(engineFrom).toISOString(),
    sales: all,
    existing,
    toCreate,
    catchUp,
    blockers,
    notes,
    canRecover: toCreate.length > 0,
    canCatchUp: catchUp.due > 0 && !!catchUp.latestSale,
    options: { notBefore: q.notBefore?.toISOString() ?? null, notAfter: q.notAfter?.toISOString() ?? null, includeBackfill: q.includeBackfill },
    _program: p,
    _config: cfgValues,
    _spinCutoff: spin.activationCutoff,
    _calendar: cal,
  };
}

type ApplyInput = RecoveryInput & { reason?: unknown; confirm?: unknown; announce?: unknown };
function checkApproval(input: ApplyInput) {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 10 || reason.length > 500) throw new RecoveryError("Write a reason (10 to 500 characters).");
  if (input.confirm !== true) throw new RecoveryError("Confirm the approval.", 428);
  return reason;
}

async function inAgentTx<T>(pool: Pool, userCode: string, programId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Same lock as the automatic engine: this never interleaves with live sales for the agent.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bonus:' || $1))`, [userCode]);
    await client.query(`SELECT 1 FROM reward_programs WHERE id = $1 FOR SHARE`, [programId]);
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function announceAllowed(p: RewardProgram, cfg: Record<string, unknown>, ownerWants: boolean) {
  const cat = (cfg.rewardCategories as Record<string, { showOnArena: boolean }>)?.[p.kind];
  const cash = p.rewardType === "cash";
  return ownerWants && cfg.arenaEnabled !== false && cfg.celebrationPopups !== false && !!cat?.showOnArena && p.showOnArena && (cash ? cfg.announceCash !== false : cfg.announcePrizes !== false);
}

/** RECOVERY: creates the missing award(s) for sales the automatic rule never counts. */
export async function applyRecovery(pool: Pool, input: ApplyInput, actor: Actor) {
  const reason = checkApproval(input);
  const q = parse(input);
  let agentName = "";
  const created = await inAgentTx(pool, q.userCode, q.programId, async (client) => {
    const pv = await previewRecovery(client, input);
    agentName = pv.agent.name;
    if (!pv.canRecover) throw new RecoveryError(`Nothing to recover. ${[...pv.blockers, ...pv.notes].join(" ")}`.trim(), 409);
    const p = pv._program;
    const announce = announceAllowed(p, pv._config, input.announce !== false);
    const snap = { name: p.name, rewardType: p.rewardType, amount: p.amount, currency: p.currency, prizeLabel: p.prizeLabel, salesRequired: p.salesRequired, description: p.description, revision: p.revision };
    const out: BonusAwardRecord[] = [];
    for (const a of pv.toCreate) {
      const ins = await client.query(
        `INSERT INTO bonus_awards (id, program_id, kind, agent_id, user_code, agent_name, period_key, n, validated_at_award, amount, prize_label,
                                   program_name, sales_required, status, trigger_sale_id, trigger_case_id, reward_type, currency, program_revision,
                                   reward_snapshot, announce, source, recovery_reason, recovered_by, recovered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'earned', $14, $15, $16, $17, $18, $19, $20, 'recovery', $21, $22, NOW())
         ON CONFLICT (id) DO NOTHING RETURNING created_at`,
        [a.id, p.id, p.kind, `agt_${q.userCode}`.slice(0, 64), q.userCode, pv.agent.name, pv.period.key, a.n, a.salesAtAward, p.amount, p.prizeLabel, p.name,
          p.salesRequired, a.triggerSaleId, a.triggerCaseId, p.rewardType, p.currency, p.revision, JSON.stringify(snap), announce, reason, actor.adminId],
      );
      if (ins.rowCount)
        out.push({ id: a.id, programId: p.id, programName: p.name, kind: p.kind, rewardType: p.rewardType, amount: p.amount, currency: p.currency, prizeLabel: p.prizeLabel, periodKey: pv.period.key, n: a.n, validatedCount: a.salesAtAward, salesRequired: p.salesRequired, announce, createdAt: new Date(ins.rows[0].created_at).toISOString() });
    }
    if (!out.length) throw new RecoveryError("Nothing to recover: the award already exists.", 409);
    await writeAudit(client, {
      adminId: actor.adminId,
      action: "bonus_award.recovered",
      targetType: "bonus_award",
      targetId: out[0].id,
      details: { reason, userCode: q.userCode, programId: p.id, programName: p.name, periodKey: pv.period.key, awards: out.map((c) => ({ id: c.id, amount: c.amount, currency: c.currency })), salesCounted: pv.sales.filter((s) => s.class === "recoverable").map((s) => s.caseId), options: pv.options },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return out;
  });
  // Only after commit: every screen updates (leaderboard, podium, Award History; popup if allowed).
  for (const c of created) arenaBroadcaster.broadcast("rewards.award.created", { award: publicAward(c, q.userCode, agentName) });
  return { mode: "recover" as const, created: created.map((c) => ({ id: c.id, amount: c.amount, currency: c.currency, periodKey: c.periodKey, n: c.n })) };
}

/** CATCH-UP: runs the real reward engine once for the selected program and period (automatic rule). */
export async function applyCatchUp(pool: Pool, input: ApplyInput, actor: Actor) {
  const reason = checkApproval(input);
  const q = parse(input);
  let agentName = "";
  const created = await inAgentTx(pool, q.userCode, q.programId, async (client) => {
    const pv = await previewRecovery(client, input);
    agentName = pv.agent.name;
    if (!pv.canCatchUp || !pv.catchUp.latestSale) throw new RecoveryError(`No automatic award is due. ${[pv.catchUp.blocked, ...pv.blockers].filter(Boolean).join(" ")}`.trim(), 409);
    const cfg = pv._config;
    const s = pv.catchUp.latestSale;
    const out = await evaluateBonusAwards(client, {
      userCode: q.userCode,
      agentId: `agt_${q.userCode}`.slice(0, 64),
      closerName: s.closerName || pv.agent.name,
      saleId: s.saleId,
      caseId: s.caseId,
      validatedAt: new Date(s.validatedAt),
      cutoff: pv._spinCutoff,
      calendar: pv._calendar,
      onlyProgramIds: [q.programId],
      config: {
        categories: cfg.rewardCategories as Record<string, { active: boolean; showOnArena: boolean }>, // a paused category earns nothing
        arenaEnabled: cfg.arenaEnabled !== false,
        celebrationPopups: cfg.celebrationPopups !== false && input.announce !== false,
        announceCash: cfg.announceCash !== false,
        announcePrizes: cfg.announcePrizes !== false,
      },
    });
    if (!out.length) throw new RecoveryError("No automatic award is due.", 409);
    // Record the Owner's approval on the catch-up awards (they stay source = 'automatic').
    await client.query(`UPDATE bonus_awards SET recovery_reason = $2, recovered_by = $3, recovered_at = NOW() WHERE id = ANY($1)`, [out.map((a) => a.id), reason, actor.adminId]);
    await writeAudit(client, {
      adminId: actor.adminId,
      action: "bonus_award.catch_up",
      targetType: "bonus_award",
      targetId: out[0].id,
      details: { reason, userCode: q.userCode, programId: q.programId, periodKey: pv.period.key, awards: out.map((c) => ({ id: c.id, amount: c.amount, currency: c.currency })), salesCounted: pv.sales.filter((x) => x.class === "counted_automatically").map((x) => x.caseId), options: pv.options },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return out;
  });
  for (const c of created) arenaBroadcaster.broadcast("rewards.award.created", { award: publicAward(c, q.userCode, agentName) });
  return { mode: "catchup" as const, created: created.map((c) => ({ id: c.id, amount: c.amount, currency: c.currency, periodKey: c.periodKey, n: c.n })) };
}

/**
 * Read-only scan of an Owner-chosen business date range (e.g. a month): every agent with validated sales
 * in the range × every active, non-duplicate program × every period touched, listing missing awards.
 * Counting is limited to sales inside the range. Nothing is written.
 */
export async function scanRecovery(db: Pool | PoolClient, input: { from?: unknown; to?: unknown; includeBackfill?: unknown }) {
  const from = typeof input.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? input.from : "";
  const to = typeof input.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? input.to : "";
  if (!from || !to || to < from) throw new RecoveryError("Choose a valid date range (from ≤ to).");
  if (Date.parse(to) - Date.parse(from) > 62 * 86400_000) throw new RecoveryError("Scan at most about two months at a time.");
  const cal = calendarFrom((await readArenaConfig(db)).values);
  const start = periodWindow("daily", new Date(`${from}T12:00:00Z`), cal).start!;
  const end = periodWindow("daily", new Date(`${to}T12:00:00Z`), cal).end!;
  const notBefore = start.toISOString();
  const notAfter = new Date(end.getTime() - 1).toISOString();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: cal.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const sales = (
    await db.query(`SELECT user_code, validated_at FROM validated_sales WHERE status = 'validated' AND validated_at >= $1 AND validated_at < $2 ORDER BY user_code, validated_at`, [start, end])
  ).rows;
  const dayByUser = new Map<string, Set<string>>();
  for (const s of sales) dayByUser.set(s.user_code, (dayByUser.get(s.user_code) ?? new Set()).add(fmt.format(new Date(s.validated_at))));
  const dupes = duplicateProgramIds(await listPrograms(db));
  const programs = (await listPrograms(db)).filter((p) => p.enabled && !dupes.has(p.id));
  const items = [];
  for (const [userCode, days] of dayByUser) {
    for (const p of programs) {
      const seen = new Set<string>();
      for (const day of days) {
        const key = periodWindow(KIND_TO_PERIOD[p.kind], new Date(`${day}T12:00:00Z`), cal).key;
        if (seen.has(key)) continue;
        seen.add(key);
        const pv = await previewRecovery(db, { userCode, programId: p.id, periodDate: day, notBefore, notAfter, includeBackfill: input.includeBackfill === true });
        if (!pv.canRecover && !pv.canCatchUp) continue;
        items.push({
          userCode,
          agentName: pv.agent.name,
          programId: p.id,
          programName: p.name,
          kind: p.kind,
          salesRequired: p.salesRequired,
          periodKey: pv.period.key,
          periodDate: day,
          recover: pv.toCreate.length ? { awards: pv.toCreate.length, amount: p.amount, currency: p.currency, sales: pv.sales.filter((s) => s.class === "recoverable").map((s) => s.caseId) } : null,
          catchUp: pv.canCatchUp ? { awards: pv.catchUp.due, amount: p.amount, currency: p.currency, sales: pv.sales.filter((s) => s.class === "counted_automatically").map((s) => s.caseId) } : null,
        });
      }
    }
  }
  return { range: { from, to, notBefore, notAfter, timezone: cal.timezone }, agents: dayByUser.size, sales: sales.length, items };
}

/** Public preview (internal fields removed). */
export function previewView(pv: Awaited<ReturnType<typeof previewRecovery>>) {
  const { _program: _p, _config: _c, _spinCutoff: _s, _calendar: _k, ...rest } = pv;
  return rest;
}
