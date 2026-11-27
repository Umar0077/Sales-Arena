import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { applyLedgerEntry, lockBalance, readSpinSettings } from "./ledger";

export interface ExpirationAuditRow {
  userCode: string;
  name: string;
  available: number;
  preCampaignAuto: number;
  preCampaignManual: number;
  campaignAuto: number;
  campaignManual: number;
  consumedTotal: number;
  expiredTotal: number;
  protectedNov27Credits: number;
  expirableCredits: number;
  ambiguous: boolean;
  note: string;
}

/**
 * Read-only dry-run audit of unused pre-campaign spin credits (created before spinCampaignStartAt).
 * Never expires Nov 27+ earned credits and never produces a negative balance.
 */
export async function previewHistoricalExpiration(db: Pool | PoolClient): Promise<{
  campaignStartAt: string;
  resetAt: string | null;
  totalAvailable: number;
  totalExpirable: number;
  rows: ExpirationAuditRow[];
}> {
  const settings = await readSpinSettings(db);
  const cutoff = settings.spinCampaignStartAt;

  const { rows } = await db.query<{
    user_code: string;
    name: string;
    available: number;
    consumed: number;
    expired: number;
    pre_auto: number;
    pre_manual: number;
    camp_auto: number;
    camp_manual: number;
  }>(
    `SELECT c.user_code,
            COALESCE(a.name, c.user_code) AS name,
            c.available::int AS available,
            c.consumed::int AS consumed,
            c.expired::int AS expired,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.kind = 'automatic' AND t.created_at < $1), 0)::int AS pre_auto,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.kind = 'manual' AND t.created_at < $1), 0)::int AS pre_manual,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.kind = 'automatic' AND t.created_at >= $1), 0)::int AS camp_auto,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.kind = 'manual' AND t.created_at >= $1), 0)::int AS camp_manual
       FROM spin_credits c
       LEFT JOIN agents a ON a.user_code = c.user_code
       LEFT JOIN spin_credit_transactions t ON t.user_code = c.user_code
      WHERE c.available > 0 OR c.expired > 0
      GROUP BY c.user_code, a.name, c.available, c.consumed, c.expired
      ORDER BY c.available DESC, name ASC`,
    [cutoff],
  );

  const auditRows: ExpirationAuditRow[] = rows.map((r) => {
    const preTotal = r.pre_auto + r.pre_manual;
    const campTotal = r.camp_auto + r.camp_manual;
    const protectedNov27Credits = Math.min(r.available, campTotal);
    const expirableCredits = Math.max(0, r.available - protectedNov27Credits);
    const ambiguous = r.consumed > 0 && preTotal > 0 && campTotal > 0;
    const note =
      expirableCredits === 0
        ? "All available credits are from the Nov 27+ campaign"
        : ambiguous
          ? `Consumed ${r.consumed} spin(s); conservatively protecting all ${protectedNov27Credits} Nov 27+ credit(s)`
          : `${expirableCredits} unused pre-campaign credit(s) eligible for expiration`;

    return {
      userCode: r.user_code,
      name: r.name,
      available: r.available,
      preCampaignAuto: r.pre_auto,
      preCampaignManual: r.pre_manual,
      campaignAuto: r.camp_auto,
      campaignManual: r.camp_manual,
      consumedTotal: r.consumed,
      expiredTotal: r.expired,
      protectedNov27Credits,
      expirableCredits,
      ambiguous,
      note,
    };
  });

  return {
    campaignStartAt: cutoff.toISOString(),
    resetAt: settings.spinCampaignResetAt?.toISOString() ?? null,
    totalAvailable: auditRows.reduce((s, r) => s + r.available, 0),
    totalExpirable: auditRows.reduce((s, r) => s + r.expirableCredits, 0),
    rows: auditRows,
  };
}

/**
 * One-time fresh campaign reset (spin-only):
 * Expires ALL currently available, unconsumed spin credits (setting every agent's
 * available balance to 0 via immutable 'expire' ledger rows), supersedes the old
 * global spin rule with a fresh Nov 27 rule version, and records spin_campaign_reset_at.
 *
 * Strictly spin-only: never modifies validated_sales, agents, teams, reward_programs,
 * bonus_awards, spin_results, or reward_activation_cutoff.
 * Idempotent by resetMarker: cannot be executed twice.
 */
export async function executeFreshCampaignReset(
  pool: Pool,
  args: {
    resetMarker: string;
    adminId: string;
    reason?: string;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<{
  alreadyExecuted: boolean;
  resetAt: string;
  newRuleId: string | null;
  expired: Array<{ userCode: string; expiredCount: number; balanceAfter: number }>;
}> {
  const marker = args.resetMarker.trim();
  if (!/^[A-Za-z0-9:_-]{4,80}$/.test(marker)) {
    throw new Error("Invalid resetMarker.");
  }
  const reason = (args.reason?.trim() || `One-time fresh campaign reset (${marker})`).slice(0, 500);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock marker row / check if already executed.
    const prev = await client.query<{ value: unknown }>(
      `SELECT value FROM admin_settings WHERE key = 'spin_campaign_reset_marker' FOR UPDATE`,
    );
    if (prev.rowCount && prev.rows[0].value === marker) {
      const resetRow = await client.query<{ value: string }>(
        `SELECT value FROM admin_settings WHERE key = 'spin_campaign_reset_at'`,
      );
      await client.query("COMMIT");
      return {
        alreadyExecuted: true,
        resetAt: String(resetRow.rows[0]?.value ?? new Date().toISOString()),
        newRuleId: null,
        expired: [],
      };
    }

    // Expire all currently available, unconsumed spin credits.
    const { rows: creditRows } = await client.query<{ user_code: string; available: number }>(
      `SELECT user_code, available::int AS available FROM spin_credits WHERE available > 0 ORDER BY user_code FOR UPDATE`,
    );

    const expired: Array<{ userCode: string; expiredCount: number; balanceAfter: number }> = [];
    for (const c of creditRows) {
      const res = await applyLedgerEntry(client, {
        userCode: c.user_code,
        kind: "expire",
        quantity: -c.available,
        idempotencyKey: `expire:fresh_reset:${marker}:${c.user_code}`,
        adminId: args.adminId,
        reason,
      });
      if (!res.replayed) {
        expired.push({ userCode: c.user_code, expiredCount: c.available, balanceAfter: res.balanceAfter });
      }
    }

    // Supersede the current global spin rule and create a clean Nov 27 rule version so
    // automatic_spin_awards has a fresh rule_id (pre-reset grants never collide or reappear).
    const now = new Date();
    const curRule = await client.query<{
      id: string;
      sales_per_spin: number;
      spins_per_threshold: number;
      period: string;
    }>(`SELECT id, sales_per_spin, spins_per_threshold, period FROM target_rules WHERE scope_type = 'global' AND superseded_at IS NULL FOR UPDATE`);
    const prevRule = curRule.rows[0];
    if (prevRule) {
      await client.query(`UPDATE target_rules SET superseded_at = $2, updated_at = NOW() WHERE id = $1`, [prevRule.id, now]);
    }
    const newRuleId = `rule_global_fresh_${randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO target_rules (id, team_id, sales_per_spin, period, enabled, scope_type, scope_id, spins_per_threshold, effective_from, created_by, change_note)
       VALUES ($1, NULL, $2, $3, TRUE, 'global', NULL, $4, '2026-11-27T05:00:00.000Z', $5, $6)`,
      [
        newRuleId,
        prevRule?.sales_per_spin ?? 2,
        prevRule?.period ?? "daily",
        prevRule?.spins_per_threshold ?? 1,
        args.adminId,
        `Fresh Nov 27 campaign reset (${marker})`,
      ],
    );

    const resetAt = now.toISOString();
    for (const [k, v] of [
      ["spin_campaign_start_at", "2026-11-27T05:00:00.000Z"],
      ["spin_campaign_reset_at", resetAt],
      ["spin_campaign_reset_marker", marker],
    ] as const) {
      await client.query(
        `INSERT INTO admin_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [k, JSON.stringify(v)],
      );
    }

    await writeAudit(client, {
      adminId: args.adminId,
      action: "spins.fresh_campaign_reset",
      targetType: "spin_credits",
      targetId: marker,
      details: {
        resetAt,
        newRuleId,
        expiredAgentsCount: expired.length,
        totalCreditsExpired: expired.reduce((s, e) => s + e.expiredCount, 0),
        expired,
      },
      ip: args.ip,
      userAgent: args.userAgent,
    });

    await client.query("COMMIT");
    return { alreadyExecuted: false, resetAt, newRuleId, expired };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Applies approved historical credit expiration via immutable 'expire' ledger transactions.
 * Idempotent per (campaignStartAt, userCode): repeated execution never expires credits twice.
 */
export async function executeHistoricalExpiration(
  pool: Pool,
  args: { userCodes: string[]; adminId: string; reason?: string; ip?: string | null; userAgent?: string | null },
): Promise<{ expired: Array<{ userCode: string; expiredCount: number; balanceAfter: number; replayed: boolean }> }> {
  const settings = await readSpinSettings(pool);
  const cutoffIso = settings.spinCampaignStartAt.toISOString().slice(0, 10);
  const reason = (args.reason?.trim() || "Pre-campaign historical spin balance expiration").slice(0, 500);
  const results: Array<{ userCode: string; expiredCount: number; balanceAfter: number; replayed: boolean }> = [];

  for (const rawCode of args.userCodes) {
    const userCode = rawCode.trim().toUpperCase();
    if (!userCode) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockBalance(client, userCode);
      const preview = await previewHistoricalExpiration(client);
      const row = preview.rows.find((r) => r.userCode === userCode);
      const toExpire = row?.expirableCredits ?? 0;
      if (toExpire <= 0) {
        await client.query("COMMIT");
        continue;
      }
      const res = await applyLedgerEntry(client, {
        userCode,
        kind: "expire",
        quantity: -toExpire,
        idempotencyKey: `expire:pre_campaign:${cutoffIso}:${userCode}`,
        adminId: args.adminId,
        reason,
      });
      if (!res.replayed) {
        await writeAudit(client, {
          adminId: args.adminId,
          action: "spins.historical_expire",
          targetType: "agent",
          targetId: userCode,
          details: { expiredCount: toExpire, balanceBefore: res.balanceBefore, balanceAfter: res.balanceAfter, reason, transactionId: res.transactionId },
          ip: args.ip,
          userAgent: args.userAgent,
        });
      }
      await client.query("COMMIT");
      results.push({ userCode, expiredCount: toExpire, balanceAfter: res.balanceAfter, replayed: res.replayed });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return { expired: results };
}
