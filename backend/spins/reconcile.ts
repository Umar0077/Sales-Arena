import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { getCompanySaleWeight, addCredits } from "@/shared/sales/weighting";
import {
  applyLedgerEntry,
  businessCalendar,
  lockBalance,
  mapRuleRow,
  readSpinSettings,
  SpinError,
  type AutoGrant,
} from "./ledger";
import {
  autoGrantKey,
  periodWindow,
  selectRule,
  thresholdsToGrant,
  zonedMidnight,
  type SpinRuleVersion,
} from "./rules";

export interface MissingSpinRow {
  userCode: string;
  name: string;
  periodKey: string;
  businessDate: string;
  rawValidatedSales: number;
  weightedCredits: number;
  salesPerSpin: number;
  spinsPerThreshold: number;
  expectedAutoSpins: number;
  grantedAutoSpins: number;
  manualEarned: number;
  consumed: number;
  available: number;
  expired: number;
  missingSpins: number;
  spinEligible: boolean;
  status: "missing" | "granted" | "below_threshold" | "ineligible" | "disabled";
  reason: string;
  ruleId: string;
  latestSaleId: string;
  latestValidatedAt: string;
}

function parseYmd(ymd: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  return [Number(y), Number(mo), Number(d)];
}

/**
 * Queries the authoritative validated_sales population (never inner-joining spin_credits
 * and never filtering by cash-bonus reward_eligible) to find every agent's expected vs.
 * granted automatic spins from spinCampaignStartAt (or optional fromDate..toDate).
 */
export async function findMissingSpins(
  db: Pool | PoolClient,
  options: { fromDate?: string; toDate?: string; q?: string } = {},
): Promise<{ campaignStartAt: string; timezone: string; autoEnabled: boolean; rows: MissingSpinRow[] }> {
  const settings = await readSpinSettings(db);
  const cal = businessCalendar();
  const campaignStart = settings.spinCampaignStartAt;

  let startBound = campaignStart;
  if (options.fromDate) {
    const p = parseYmd(options.fromDate);
    if (p) {
      const fromMidnight = zonedMidnight(p[0], p[1], p[2], cal.timezone);
      startBound = new Date(Math.max(fromMidnight.getTime(), campaignStart.getTime()));
    }
  }
  let endBound: Date | null = null;
  if (options.toDate) {
    const p = parseYmd(options.toDate);
    if (p) {
      const nextDay = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
      endBound = zonedMidnight(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), cal.timezone);
    }
  }

  const currentRules = (
    await db.query(`SELECT * FROM target_rules WHERE superseded_at IS NULL`)
  ).rows.map(mapRuleRow);

  const searchQ = (options.q ?? "").trim().toLowerCase();

  // Authoritative sales query: LEFT JOIN agents and spin_credits so agents without any
  // spin_credits row yet are ALWAYS included.
  const { rows: saleRows } = await db.query<{
    id: string;
    user_code: string;
    closer_name: string | null;
    agent_name: string | null;
    team_id: string | null;
    campaign_id: string | null;
    spin_eligible: boolean | null;
    carrier: string | null;
    validated_at: string;
    available: number | null;
    auto_earned: number | null;
    manual_earned: number | null;
    consumed: number | null;
  }>(
    `SELECT vs.id, vs.user_code, vs.closer_name,
            a.name AS agent_name,
            COALESCE(
              (SELECT m.team_id
                 FROM team_memberships m
                 JOIN teams t ON t.id = m.team_id AND t.active
                WHERE m.user_code = vs.user_code
                  AND m.effective_from <= (vs.validated_at AT TIME ZONE $3)::date
                  AND (m.effective_to IS NULL OR m.effective_to > (vs.validated_at AT TIME ZONE $3)::date)
                ORDER BY m.effective_from DESC
                LIMIT 1),
              a.team_id
            ) AS team_id,
            a.campaign_id, COALESCE(a.spin_eligible, TRUE) AS spin_eligible,
            vs.carrier, vs.validated_at,
            COALESCE(c.available, 0)::int AS available,
            COALESCE(c.auto_earned, 0)::int AS auto_earned,
            COALESCE(c.manual_earned, 0)::int AS manual_earned,
            COALESCE(c.consumed, 0)::int AS consumed
       FROM validated_sales vs
       LEFT JOIN agents a ON a.user_code = vs.user_code
       LEFT JOIN spin_credits c ON c.user_code = vs.user_code
      WHERE vs.status = 'validated'
        AND vs.source <> 'backfill'
        AND vs.validated_at >= $1
        AND ($2::timestamptz IS NULL OR vs.validated_at < $2)
      ORDER BY vs.validated_at ASC`,
    [startBound, endBound, cal.timezone],
  );

  const fallbackRule: SpinRuleVersion = {
    id: "rule_default_2",
    scopeType: "global",
    scopeId: null,
    salesPerSpin: 2,
    spinsPerThreshold: 1,
    period: "daily",
    enabled: true,
    effectiveFrom: campaignStart,
    supersededAt: null,
  };

  interface Bucket {
    userCode: string;
    name: string;
    periodKey: string;
    businessDate: string;
    rawValidatedSales: number;
    weightedCredits: number;
    rule: SpinRuleVersion;
    spinEligible: boolean;
    available: number;
    manualEarned: number;
    consumed: number;
    expired: number;
    latestSaleId: string;
    latestValidatedAt: string;
  }

  const buckets = new Map<string, Bucket>();
  for (const s of saleRows) {
    const name = (s.agent_name || s.closer_name || s.user_code).trim();
    if (searchQ && !name.toLowerCase().includes(searchQ) && !s.user_code.toLowerCase().includes(searchQ)) {
      continue;
    }
    const rule =
      selectRule(currentRules, { teamId: s.team_id, campaignId: s.campaign_id }, new Date()) ??
      fallbackRule;
    const validatedAt = new Date(s.validated_at);
    const win = periodWindow(rule.period, validatedAt, cal);
    const dayWin = periodWindow("daily", validatedAt, cal);
    const businessDate = dayWin.key.replace(/^D:/, "");
    const key = `${s.user_code}::${rule.id}::${win.key}`;

    let b = buckets.get(key);
    if (!b) {
      b = {
        userCode: s.user_code,
        name,
        periodKey: win.key,
        businessDate,
        rawValidatedSales: 0,
        weightedCredits: 0,
        rule,
        spinEligible: s.spin_eligible !== false,
        available: Number(s.available ?? 0),
        manualEarned: Number(s.manual_earned ?? 0),
        consumed: Number(s.consumed ?? 0),
        expired: 0,
        latestSaleId: s.id,
        latestValidatedAt: validatedAt.toISOString(),
      };
      buckets.set(key, b);
    }
    b.rawValidatedSales += 1;
    b.weightedCredits = addCredits(b.weightedCredits, getCompanySaleWeight(s.carrier));
    if (validatedAt.toISOString() >= b.latestValidatedAt) {
      b.latestSaleId = s.id;
      b.latestValidatedAt = validatedAt.toISOString();
    }
  }

  // Load already-granted post-reset automatic spins per (rule_id, user_code, period_key).
  // Pre-reset entitlements (created before spinCampaignResetAt) are ignored after a fresh reset.
  const { rows: awardRows } = await db.query<{
    rule_id: string;
    user_code: string;
    period_key: string;
    granted: number;
    max_threshold: number;
  }>(
    `SELECT rule_id, user_code, period_key,
            COALESCE(SUM(quantity), 0)::int AS granted,
            COALESCE(MAX(threshold_n), 0)::int AS max_threshold
       FROM automatic_spin_awards
      WHERE ($1::timestamptz IS NULL OR created_at >= $1)
      GROUP BY rule_id, user_code, period_key`,
    [settings.spinCampaignResetAt],
  );
  const awardMap = new Map<string, { granted: number; maxThreshold: number }>();
  for (const a of awardRows) {
    awardMap.set(`${a.rule_id}::${a.user_code}::${a.period_key}`, {
      granted: Number(a.granted),
      maxThreshold: Number(a.max_threshold),
    });
  }

  const out: MissingSpinRow[] = [];
  for (const b of buckets.values()) {
    const aw = awardMap.get(`${b.rule.id}::${b.userCode}::${b.periodKey}`);
    const grantedAutoSpins = aw?.granted ?? 0;
    const expectedAutoSpins =
      Math.floor(b.rawValidatedSales / Math.max(1, b.rule.salesPerSpin)) * b.rule.spinsPerThreshold;
    const missingSpins =
      b.spinEligible && b.rule.enabled && settings.autoEnabled
        ? Math.max(0, expectedAutoSpins - grantedAutoSpins)
        : 0;

    let status: MissingSpinRow["status"] = "granted";
    let reason = "All eligible spins granted";
    if (!settings.autoEnabled || !b.rule.enabled) {
      status = "disabled";
      reason = !settings.autoEnabled ? "Automatic spins disabled in settings" : "Active rule is disabled";
    } else if (!b.spinEligible) {
      status = "ineligible";
      reason = "Agent marked spin-ineligible";
    } else if (expectedAutoSpins === 0) {
      status = "below_threshold";
      reason = `Below threshold (${b.rawValidatedSales}/${b.rule.salesPerSpin} validated sales)`;
    } else if (missingSpins > 0) {
      status = "missing";
      reason = `${missingSpins} missing spin${missingSpins === 1 ? "" : "s"} (${b.rawValidatedSales} validated sales)`;
    }

    out.push({
      userCode: b.userCode,
      name: b.name,
      periodKey: b.periodKey,
      businessDate: b.businessDate,
      rawValidatedSales: b.rawValidatedSales,
      weightedCredits: b.weightedCredits,
      salesPerSpin: b.rule.salesPerSpin,
      spinsPerThreshold: b.rule.spinsPerThreshold,
      expectedAutoSpins,
      grantedAutoSpins,
      manualEarned: b.manualEarned,
      consumed: b.consumed,
      available: b.available,
      expired: b.expired,
      missingSpins,
      spinEligible: b.spinEligible,
      status,
      reason,
      ruleId: b.rule.id,
      latestSaleId: b.latestSaleId,
      latestValidatedAt: b.latestValidatedAt,
    });
  }

  out.sort((a, b) => b.missingSpins - a.missingSpins || b.rawValidatedSales - a.rawValidatedSales || a.name.localeCompare(b.name));
  return {
    campaignStartAt: campaignStart.toISOString(),
    timezone: cal.timezone,
    autoEnabled: settings.autoEnabled,
    rows: out,
  };
}

/**
 * Idempotently grants missing automatic spin credits for one agent (and optional periodKey)
 * using PostgreSQL row locking, deterministic idempotency keys, and audit logging.
 */
export async function approveMissingSpinsForAgent(
  pool: Pool,
  args: { userCode: string; periodKey?: string; adminId: string; ip?: string | null; userAgent?: string | null },
): Promise<{ userCode: string; closerName: string; grants: AutoGrant[]; balanceAfter: number }> {
  const userCode = args.userCode.trim().toUpperCase();
  const cal = businessCalendar();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const bal = await lockBalance(client, userCode);
    const agentRow = (
      await client.query<{ name: string; team_id: string | null; campaign_id: string | null; spin_eligible: boolean }>(
        `SELECT a.name,
                COALESCE(
                  (SELECT m.team_id
                     FROM team_memberships m
                     JOIN teams t ON t.id = m.team_id AND t.active
                    WHERE m.user_code = a.user_code
                      AND m.effective_from <= (NOW() AT TIME ZONE $2)::date
                      AND (m.effective_to IS NULL OR m.effective_to > (NOW() AT TIME ZONE $2)::date)
                    ORDER BY m.effective_from DESC
                    LIMIT 1),
                  a.team_id
                ) AS team_id,
                a.campaign_id,
                a.spin_eligible
           FROM agents a
          WHERE a.user_code = $1`,
        [userCode, cal.timezone],
      )
    ).rows[0];
    if (!agentRow) throw new SpinError("agent_not_found", "Agent not found.");
    if (!agentRow.spin_eligible) throw new SpinError("invalid_input", "Agent is marked spin-ineligible.");

    const settings = await readSpinSettings(client);
    const campaignStart = settings.spinCampaignStartAt;
    const currentRules = (await client.query(`SELECT * FROM target_rules WHERE superseded_at IS NULL`)).rows.map(mapRuleRow);
    const rule = selectRule(currentRules, { teamId: agentRow.team_id, campaignId: agentRow.campaign_id }, new Date());
    if (!rule || !rule.enabled) throw new SpinError("invalid_input", "No enabled spin rule applies to this agent.");

    const { rows: sales } = await client.query<{ id: string; validated_at: string }>(
      `SELECT id, validated_at FROM validated_sales
        WHERE user_code = $1 AND status = 'validated' AND source <> 'backfill' AND validated_at >= $2
        ORDER BY validated_at ASC`,
      [userCode, campaignStart],
    );

    const byPeriod = new Map<string, { count: number; latestSaleId: string }>();
    for (const s of sales) {
      const win = periodWindow(rule.period, new Date(s.validated_at), cal);
      if (args.periodKey && win.key !== args.periodKey) continue;
      const cur = byPeriod.get(win.key) ?? { count: 0, latestSaleId: s.id };
      cur.count += 1;
      cur.latestSaleId = s.id;
      byPeriod.set(win.key, cur);
    }

    const grants: AutoGrant[] = [];
    let balanceAfter = Number(bal.available);

    for (const [periodKey, info] of byPeriod.entries()) {
      const granted = await client.query<{ n: number }>(
        `SELECT COALESCE(MAX(threshold_n), 0)::int AS n FROM automatic_spin_awards WHERE rule_id = $1 AND user_code = $2 AND period_key = $3`,
        [rule.id, userCode, periodKey],
      );
      for (const n of thresholdsToGrant(info.count, rule.salesPerSpin, Number(granted.rows[0].n))) {
        const res = await applyLedgerEntry(client, {
          userCode,
          kind: "automatic",
          quantity: rule.spinsPerThreshold,
          idempotencyKey: autoGrantKey(rule.id, userCode, periodKey, n),
          adminId: args.adminId,
          reason: `Missing spin approved (${periodKey})`,
          ruleId: rule.id,
          periodKey,
          thresholdN: n,
          saleId: info.latestSaleId,
        });
        if (res.replayed) continue;
        await client.query(
          `INSERT INTO automatic_spin_awards (transaction_id, user_code, rule_id, period_key, threshold_n, sales_counted, trigger_sale_id, quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [res.transactionId, userCode, rule.id, periodKey, n, n * rule.salesPerSpin, info.latestSaleId, rule.spinsPerThreshold],
        );
        await writeAudit(client, {
          adminId: args.adminId,
          action: "spins.reconcile_approve",
          targetType: "agent",
          targetId: userCode,
          details: { ruleId: rule.id, periodKey, thresholdN: n, quantity: rule.spinsPerThreshold, balanceAfter: res.balanceAfter, transactionId: res.transactionId },
          ip: args.ip,
          userAgent: args.userAgent,
        });
        balanceAfter = res.balanceAfter;
        grants.push({
          ruleId: rule.id,
          periodKey,
          thresholdN: n,
          quantity: rule.spinsPerThreshold,
          balanceAfter: res.balanceAfter,
          transactionId: res.transactionId,
          salesCounted: n * rule.salesPerSpin,
        });
      }
    }

    await client.query("COMMIT");
    return { userCode, closerName: agentRow.name, grants, balanceAfter };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
