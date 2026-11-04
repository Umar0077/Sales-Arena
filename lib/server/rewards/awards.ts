import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { arenaBroadcaster } from "../events/broadcaster";

/**
 * Award records (bonus_awards) and their fulfilment workflow. Awards are never deleted.
 * Earning a cash bonus never means it was paid: payment is a separate, audited admin step.
 *
 *   earned → pending_approval → approved → paid
 *   earned / pending_approval / approved → cancelled   (note required)
 *   paid → reversed                                     (note required)
 *
 * Highest-tier chains: when a higher tier supersedes an award, the old one stays for history but is no
 * longer a separate payable entitlement (pay the current tier instead). Cancelling or reversing an award
 * that is part of an upgrade chain is refused here: it changes what the other tiers owe and needs a
 * deliberate manual financial adjustment.
 */

export const AWARD_STATUSES = ["earned", "pending_approval", "approved", "paid", "reversed", "cancelled"] as const;
export type AwardStatus = (typeof AWARD_STATUSES)[number];

const NEXT: Record<AwardStatus, AwardStatus[]> = {
  earned: ["pending_approval", "approved", "cancelled"],
  pending_approval: ["approved", "cancelled"],
  approved: ["paid", "cancelled"],
  paid: ["reversed"],
  reversed: [],
  cancelled: [],
};
export const allowedTransitions = (from: AwardStatus) => NEXT[from] ?? [];

export class AwardError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface AwardRow {
  id: string;
  programId: string;
  programName: string;
  kind: string;
  rewardType: string;
  agentId: string | null;
  userCode: string;
  agentName: string;
  periodKey: string;
  n: number;
  validatedAtAward: number;
  salesRequired: number;
  /** Tier amount = the total entitlement while this award is the effective one. */
  amount: number;
  currency: string;
  prizeLabel: string;
  status: AwardStatus;
  statusNote: string | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  triggerCaseId: string | null;
  /** "automatic" (reward engine) or "recovery" (Owner-approved historical recovery). */
  source: "automatic" | "recovery";
  recoveryReason: string | null;
  recoveredBy: string | null;
  recoveredAt: string | null;
  programRevision: number | null;
  announce: boolean;
  createdAt: string;
  tierPolicy: "highest_tier" | "additive";
  rewardGroup: string;
  /** Effective = counts toward the agent's entitlement (not superseded, not cancelled / reversed). */
  effective: boolean;
  supersededBy: string | null;
  supersededByName: string | null;
  supersededAt: string | null;
  supersedesId: string | null;
  previousAmount: number;
  incrementAmount: number;
  /** Cash this award is responsible for paying (0 for an unpaid superseded tier). */
  payableAmount: number;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
function map(r: Record<string, unknown>): AwardRow {
  const status = r.status as AwardStatus;
  return {
    id: String(r.id),
    programId: String(r.program_id),
    programName: String(r.program_name),
    kind: String(r.kind),
    rewardType: String(r.reward_type ?? "cash"),
    agentId: (r.agent_id as string) ?? null,
    userCode: String(r.user_code),
    agentName: String(r.agent_name),
    periodKey: String(r.period_key),
    n: Number(r.n),
    validatedAtAward: Number(r.validated_at_award),
    salesRequired: Number(r.sales_required),
    amount: Number(r.amount),
    currency: String(r.currency ?? "Rs."),
    prizeLabel: String(r.prize_label ?? ""),
    status,
    statusNote: (r.status_note as string) ?? null,
    statusChangedAt: iso(r.status_changed_at),
    statusChangedBy: (r.changed_by_email as string) ?? null,
    triggerCaseId: (r.trigger_case_id as string) ?? null,
    source: (r.source as "automatic" | "recovery") ?? "automatic",
    recoveryReason: (r.recovery_reason as string) ?? null,
    recoveredBy: (r.recovered_by_email as string) ?? null,
    recoveredAt: iso(r.recovered_at),
    programRevision: r.program_revision == null ? null : Number(r.program_revision),
    announce: Boolean(r.announce),
    createdAt: iso(r.created_at)!,
    tierPolicy: (r.tier_policy as AwardRow["tierPolicy"]) ?? "additive",
    rewardGroup: String(r.reward_group ?? "default"),
    effective: !r.superseded_by && status !== "cancelled" && status !== "reversed",
    supersededBy: (r.superseded_by as string) ?? null,
    supersededByName: (r.superseded_by_name as string) ?? null,
    supersededAt: iso(r.superseded_at),
    supersedesId: (r.supersedes_id as string) ?? null,
    previousAmount: Number(r.previous_amount ?? 0),
    incrementAmount: Number(r.increment_amount ?? r.amount),
    payableAmount: Number(r.payable_amount ?? r.amount),
  };
}

const SELECT = `SELECT a.*, u.email AS changed_by_email, ru.email AS recovered_by_email, sb.program_name AS superseded_by_name
  FROM bonus_awards a
  LEFT JOIN admin_users u ON u.id = a.status_changed_by
  LEFT JOIN admin_users ru ON ru.id = a.recovered_by
  LEFT JOIN bonus_awards sb ON sb.id = a.superseded_by`;

export interface AwardTotals {
  count: number;
  /** Effective cash entitlement: only the current tier of each chain (superseded tiers excluded). */
  cash: number;
  /** Cash already paid (each award's paid amount; never double counted across tiers). */
  paid: number;
  /** Cash still payable (unpaid effective entitlements minus what earlier tiers already paid). */
  outstanding: number;
  superseded: number;
}

export async function listAwards(
  db: Pool | PoolClient,
  f: { kind?: string | null; status?: string | null; programId?: string | null; userCode?: string | null; limit?: number; effectiveOnly?: boolean; audience?: string | null } = {},
): Promise<{ awards: AwardRow[]; totals: AwardTotals }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.kind) add("a.kind = ?", f.kind);
  if (f.status) add("a.status = ?", f.status);
  if (f.programId) add("a.program_id = ?", f.programId);
  if (f.userCode) add("a.user_code = ?", f.userCode.toUpperCase());
  if (f.effectiveOnly) where.push("a.superseded_by IS NULL");
  // Junior awards carry a "junior…" reward group (enforced on their programmes); everything else is Senior / all-agent.
  if (f.audience === "junior") where.push("a.reward_group LIKE 'junior%'");
  if (f.audience === "senior") where.push("a.reward_group NOT LIKE 'junior%'");
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, f.limit ?? 200));
  const { rows } = await db.query(`${SELECT} ${w} ORDER BY a.created_at DESC, a.id LIMIT ${limit}`, params);
  const t = (
    await db.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(a.amount) FILTER (WHERE a.reward_type = 'cash' AND a.superseded_by IS NULL AND a.status NOT IN ('reversed', 'cancelled')), 0)::float AS cash,
              COALESCE(SUM(a.payable_amount) FILTER (WHERE a.reward_type = 'cash' AND a.status = 'paid'), 0)::float AS paid,
              COALESCE(SUM(a.payable_amount) FILTER (WHERE a.reward_type = 'cash' AND a.status IN ('earned', 'pending_approval', 'approved')), 0)::float AS outstanding,
              COUNT(*) FILTER (WHERE a.superseded_by IS NOT NULL)::int AS superseded
         FROM bonus_awards a ${w}`,
      params,
    )
  ).rows[0];
  return { awards: rows.map(map), totals: { count: t.count, cash: Number(t.cash), paid: Number(t.paid), outstanding: Number(t.outstanding), superseded: t.superseded } };
}

export async function setAwardStatus(
  pool: Pool,
  id: string,
  body: { status?: unknown; note?: unknown },
  actor: { adminId: string; ip: string | null; userAgent: string | null },
): Promise<AwardRow> {
  const to = body.status as AwardStatus;
  if (!AWARD_STATUSES.includes(to)) throw new AwardError("Choose a valid status.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if ((to === "cancelled" || to === "reversed") && !note) throw new AwardError("Add a reason when cancelling or reversing an award.");
  const client = await pool.connect();
  let row: AwardRow;
  try {
    await client.query("BEGIN");
    const cur = (await client.query(`SELECT status, amount, payable_amount, reward_type, superseded_by, supersedes_id FROM bonus_awards WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!cur) throw new AwardError("Award not found.", 404);
    if (cur.superseded_by)
      throw new AwardError("This tier was superseded by a higher tier and is no longer a separate payable entitlement. Manage the current (highest) tier instead.", 409);
    if (cur.supersedes_id && (to === "cancelled" || to === "reversed"))
      throw new AwardError("This award upgraded a lower tier. Cancelling or reversing it changes what the earlier tiers owe, so it needs a manual financial adjustment.", 409);
    if (!allowedTransitions(cur.status).includes(to)) throw new AwardError(`An award that is "${cur.status}" cannot become "${to}".`, 409);
    await client.query(`UPDATE bonus_awards SET status = $2, status_note = $3, status_changed_at = NOW(), status_changed_by = $4 WHERE id = $1`, [id, to, note || null, actor.adminId]);
    await writeAudit(client, {
      adminId: actor.adminId,
      action: "bonus_award.status",
      targetType: "bonus_award",
      targetId: id,
      details: { from: cur.status, to, note: note || undefined, amount: Number(cur.amount), payableAmount: Number(cur.payable_amount), rewardType: cur.reward_type },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    row = map((await client.query(`${SELECT} WHERE a.id = $1`, [id])).rows[0]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  arenaBroadcaster.broadcast("rewards.award.updated", { awardId: id, status: row.status });
  return row;
}
