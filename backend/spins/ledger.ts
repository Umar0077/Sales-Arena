import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import {
  autoGrantKey,
  countingStart,
  periodWindow,
  selectRule,
  thresholdsToGrant,
  type BusinessCalendar,
  type SpinRuleVersion,
} from "./rules";

/**
 * PostgreSQL spin credit ledger — the only source of truth for spin balances.
 * Every change: lock the agent's balance row → replay check by idempotency key →
 * write one immutable ledger row with before/after balances → update the balance.
 * The balance can never go negative (CHECK constraints + explicit check).
 */

export class SpinError extends Error {
  constructor(
    public code: "agent_not_found" | "insufficient_credits" | "invalid_input" | "no_prizes" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

export interface SpinSettings {
  autoEnabled: boolean;
  /** Automatic rewards only for sales validated at/after this time. null = automatic rewards off. */
  activationCutoff: Date | null;
  manualMaxPerGrant: number;
}

export function businessCalendar(weekStartDay = 1): BusinessCalendar {
  return { timezone: process.env.SALES_ARENA_TIMEZONE || "America/New_York", weekStartDay };
}

export async function readSpinSettings(db: Pool | PoolClient): Promise<SpinSettings> {
  const { rows } = await db.query(
    `SELECT key, value FROM admin_settings WHERE key IN ('auto_spins_enabled', 'reward_activation_cutoff', 'manual_spin_max_per_grant')`,
  );
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const cutoffRaw = m.get("reward_activation_cutoff");
  const cutoff = typeof cutoffRaw === "string" ? new Date(cutoffRaw) : null;
  const max = Number(m.get("manual_spin_max_per_grant"));
  return {
    autoEnabled: m.get("auto_spins_enabled") === true,
    activationCutoff: cutoff && !Number.isNaN(cutoff.getTime()) ? cutoff : null,
    manualMaxPerGrant: Number.isInteger(max) && max > 0 ? max : 50,
  };
}

export function mapRuleRow(r: Record<string, unknown>): SpinRuleVersion {
  return {
    id: String(r.id),
    scopeType: r.scope_type as SpinRuleVersion["scopeType"],
    scopeId: (r.scope_id as string | null) ?? null,
    salesPerSpin: Number(r.sales_per_spin),
    spinsPerThreshold: Number(r.spins_per_threshold),
    period: r.period as SpinRuleVersion["period"],
    enabled: Boolean(r.enabled),
    effectiveFrom: new Date(r.effective_from as string),
    supersededAt: r.superseded_at ? new Date(r.superseded_at as string) : null,
  };
}

export interface LedgerEntryInput {
  userCode: string;
  kind: "automatic" | "manual" | "consume";
  quantity: number;
  idempotencyKey: string;
  adminId?: string | null;
  reason?: string | null;
  ruleId?: string | null;
  periodKey?: string | null;
  thresholdN?: number | null;
  saleId?: string | null;
  spinResultId?: string | null;
}

export interface LedgerEntryResult {
  replayed: boolean;
  transactionId: number;
  balanceBefore: number;
  balanceAfter: number;
}

/** Locks (creating if needed) the agent's balance row. Call inside a transaction. */
export async function lockBalance(client: PoolClient, userCode: string) {
  const agent = await client.query(`SELECT id FROM agents WHERE user_code = $1`, [userCode]);
  if (!agent.rowCount) throw new SpinError("agent_not_found", "Agent not found.");
  await client.query(
    // No conflict target: concurrent first-time inserts can collide on either unique key (id or user_code).
    `INSERT INTO spin_credits (id, user_code, agent_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [`credit_${userCode}`, userCode, agent.rows[0].id],
  );
  const { rows } = await client.query(`SELECT * FROM spin_credits WHERE user_code = $1 FOR UPDATE`, [userCode]);
  return rows[0] as { agent_id: string; available: number };
}

/** Writes one ledger entry. Call inside a transaction AFTER lockBalance(). */
export async function applyLedgerEntry(client: PoolClient, e: LedgerEntryInput): Promise<LedgerEntryResult> {
  if (!Number.isInteger(e.quantity) || e.quantity === 0) throw new SpinError("invalid_input", "Quantity must be a non-zero whole number.");
  const existing = await client.query(
    `SELECT id, user_code, kind, quantity, balance_before, balance_after FROM spin_credit_transactions WHERE idempotency_key = $1`,
    [e.idempotencyKey],
  );
  if (existing.rowCount) {
    const r = existing.rows[0];
    // The same key must describe the same operation; anything else is a client bug.
    if (r.user_code !== e.userCode || r.kind !== e.kind || r.quantity !== e.quantity)
      throw new SpinError("conflict", "This request key was already used for a different operation.");
    return { replayed: true, transactionId: Number(r.id), balanceBefore: r.balance_before, balanceAfter: r.balance_after };
  }

  const bal = await client.query(`SELECT agent_id, available FROM spin_credits WHERE user_code = $1 FOR UPDATE`, [e.userCode]);
  if (!bal.rowCount) throw new SpinError("agent_not_found", "Agent not found.");
  const before = Number(bal.rows[0].available);
  const after = before + e.quantity;
  if (after < 0) throw new SpinError("insufficient_credits", "No spins available.");

  const ins = await client.query(
    `INSERT INTO spin_credit_transactions
       (user_code, agent_id, kind, quantity, balance_before, balance_after, admin_id, reason, rule_id, period_key, threshold_n, sale_id, spin_result_id, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [
      e.userCode, bal.rows[0].agent_id, e.kind, e.quantity, before, after, e.adminId ?? null, e.reason ?? null,
      e.ruleId ?? null, e.periodKey ?? null, e.thresholdN ?? null, e.saleId ?? null, e.spinResultId ?? null, e.idempotencyKey,
    ],
  );
  const col = e.kind === "automatic" ? "auto_earned" : e.kind === "manual" ? "manual_earned" : "consumed";
  const delta = Math.abs(e.quantity);
  // Legacy columns (earned/bonus/used) are kept in step for older readers.
  const legacy = e.kind === "automatic" ? "earned" : e.kind === "manual" ? "bonus" : "used";
  await client.query(
    `UPDATE spin_credits SET available = $2, ${col} = ${col} + $3, ${legacy} = ${legacy} + $3,
       last_spin_at = CASE WHEN $4 THEN NOW() ELSE last_spin_at END, updated_at = NOW()
     WHERE user_code = $1`,
    [e.userCode, after, delta, e.kind === "consume"],
  );
  return { replayed: false, transactionId: Number(ins.rows[0].id), balanceBefore: before, balanceAfter: after };
}

export interface ManualAllocationInput {
  userCode: string;
  quantity: number;
  reason: string;
  idempotencyKey: string;
  adminId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** Admin grants spins to an agent. Atomic, idempotent, audited. */
export async function allocateManualSpins(pool: Pool, input: ManualAllocationInput): Promise<LedgerEntryResult & { userCode: string }> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3 || reason.length > 500) throw new SpinError("invalid_input", "Enter a reason (3–500 characters).");
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(input.idempotencyKey)) throw new SpinError("invalid_input", "Missing or invalid request key.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const settings = await readSpinSettings(client);
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > settings.manualMaxPerGrant)
      throw new SpinError("invalid_input", `Quantity must be a whole number from 1 to ${settings.manualMaxPerGrant}.`);
    await lockBalance(client, input.userCode);
    const res = await applyLedgerEntry(client, {
      userCode: input.userCode,
      kind: "manual",
      quantity: input.quantity,
      idempotencyKey: `manual:${input.idempotencyKey}`,
      adminId: input.adminId,
      reason,
    });
    if (!res.replayed) {
      await client.query(
        `INSERT INTO manual_spin_allocations (transaction_id, user_code, admin_id, quantity, reason) VALUES ($1, $2, $3, $4, $5)`,
        [res.transactionId, input.userCode, input.adminId, input.quantity, reason],
      );
      await writeAudit(client, {
        adminId: input.adminId,
        action: "spins.manual_allocate",
        targetType: "agent",
        targetId: input.userCode,
        details: { quantity: input.quantity, reason, balanceBefore: res.balanceBefore, balanceAfter: res.balanceAfter, transactionId: res.transactionId },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    }
    await client.query("COMMIT");
    return { ...res, userCode: input.userCode };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface AutoGrant {
  ruleId: string;
  periodKey: string;
  thresholdN: number;
  quantity: number;
  balanceAfter: number;
  /** Ledger transaction id (stable event id for the Live Arena). */
  transactionId: number;
  /** Eligible validated sales that earned this grant (threshold × sales per spin). */
  salesCounted: number;
}

/**
 * Grants automatic spins earned by an agent's eligible validated sales.
 * Must run inside the transaction that recorded the triggering sale. It locks the
 * agent's balance row BEFORE counting, so concurrent sales for one agent are
 * evaluated one after another and every threshold is granted exactly once.
 */
export async function grantAutomaticSpins(
  client: PoolClient,
  args: { userCode: string; triggerSaleId: string; validatedAt: Date; calendar?: BusinessCalendar },
): Promise<AutoGrant[]> {
  const settings = await readSpinSettings(client);
  if (!settings.autoEnabled || !settings.activationCutoff) return [];
  if (args.validatedAt.getTime() < settings.activationCutoff.getTime()) return [];

  const agent = (
    await client.query(`SELECT team_id, campaign_id, spin_eligible FROM agents WHERE user_code = $1`, [args.userCode])
  ).rows[0];
  if (!agent || !agent.spin_eligible) return [];

  await lockBalance(client, args.userCode); // serialise per agent before counting

  const rules = (
    await client.query(`SELECT * FROM target_rules WHERE effective_from <= $1 AND (superseded_at IS NULL OR superseded_at > $1)`, [args.validatedAt])
  ).rows.map(mapRuleRow);
  const rule = selectRule(rules, { teamId: agent.team_id, campaignId: agent.campaign_id }, args.validatedAt);
  if (!rule || !rule.enabled) return [];

  const cal = args.calendar ?? businessCalendar();
  const win = periodWindow(rule.period, args.validatedAt, cal);
  const start = countingStart(rule, win, settings.activationCutoff);
  // Count only reward-eligible, still-validated sales in [start, end) that this rule version covers.
  const cnt = await client.query(
    `SELECT COUNT(*)::int AS n FROM validated_sales
      WHERE user_code = $1 AND reward_eligible AND status = 'validated'
        AND validated_at >= $2 AND ($3::timestamptz IS NULL OR validated_at < $3)
        AND ($4::timestamptz IS NULL OR validated_at < $4)`,
    [args.userCode, start, win.end, rule.supersededAt],
  );
  const granted = await client.query(
    `SELECT COALESCE(MAX(threshold_n), 0)::int AS n FROM automatic_spin_awards WHERE rule_id = $1 AND user_code = $2 AND period_key = $3`,
    [rule.id, args.userCode, win.key],
  );
  const out: AutoGrant[] = [];
  for (const n of thresholdsToGrant(cnt.rows[0].n, rule.salesPerSpin, granted.rows[0].n)) {
    const res = await applyLedgerEntry(client, {
      userCode: args.userCode,
      kind: "automatic",
      quantity: rule.spinsPerThreshold,
      idempotencyKey: autoGrantKey(rule.id, args.userCode, win.key, n),
      ruleId: rule.id,
      periodKey: win.key,
      thresholdN: n,
      saleId: args.triggerSaleId,
    });
    if (res.replayed) continue;
    await client.query(
      `INSERT INTO automatic_spin_awards (transaction_id, user_code, rule_id, period_key, threshold_n, sales_counted, trigger_sale_id, quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [res.transactionId, args.userCode, rule.id, win.key, n, n * rule.salesPerSpin, args.triggerSaleId, rule.spinsPerThreshold],
    );
    out.push({ ruleId: rule.id, periodKey: win.key, thresholdN: n, quantity: rule.spinsPerThreshold, balanceAfter: res.balanceAfter, transactionId: res.transactionId, salesCounted: n * rule.salesPerSpin });
  }
  return out;
}
