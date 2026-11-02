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
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
function map(r: Record<string, unknown>): AwardRow {
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
    status: r.status as AwardStatus,
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
  };
}

export async function listAwards(
  db: Pool | PoolClient,
  f: { kind?: string | null; status?: string | null; programId?: string | null; userCode?: string | null; limit?: number } = {},
): Promise<{ awards: AwardRow[]; totals: { count: number; cash: number } }> {
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
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, f.limit ?? 200));
  const { rows } = await db.query(
    `SELECT a.*, u.email AS changed_by_email, ru.email AS recovered_by_email FROM bonus_awards a LEFT JOIN admin_users u ON u.id = a.status_changed_by LEFT JOIN admin_users ru ON ru.id = a.recovered_by
      ${w} ORDER BY a.created_at DESC, a.id LIMIT ${limit}`,
    params,
  );
  const t = await db.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount) FILTER (WHERE reward_type = 'cash' AND status NOT IN ('reversed', 'cancelled')), 0)::float AS cash
       FROM bonus_awards a ${w}`,
    params,
  );
  return { awards: rows.map(map), totals: { count: t.rows[0].count, cash: Number(t.rows[0].cash) } };
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
    const cur = (await client.query(`SELECT status, amount, reward_type FROM bonus_awards WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!cur) throw new AwardError("Award not found.", 404);
    if (!allowedTransitions(cur.status).includes(to)) throw new AwardError(`An award that is "${cur.status}" cannot become "${to}".`, 409);
    await client.query(`UPDATE bonus_awards SET status = $2, status_note = $3, status_changed_at = NOW(), status_changed_by = $4 WHERE id = $1`, [id, to, note || null, actor.adminId]);
    await writeAudit(client, {
      adminId: actor.adminId,
      action: "bonus_award.status",
      targetType: "bonus_award",
      targetId: id,
      details: { from: cur.status, to, note: note || undefined, amount: Number(cur.amount), rewardType: cur.reward_type },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    row = map((await client.query(`SELECT a.*, u.email AS changed_by_email, ru.email AS recovered_by_email FROM bonus_awards a LEFT JOIN admin_users u ON u.id = a.status_changed_by LEFT JOIN admin_users ru ON ru.id = a.recovered_by WHERE a.id = $1`, [id])).rows[0]);
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
