import type { Pool } from "pg";
import { arenaBroadcaster } from "../events/broadcaster";
import { businessCalendar, grantAutomaticSpins, readSpinSettings, type AutoGrant } from "../spins/ledger";
import { evaluateBonusAwards, type BonusAwardRecord } from "../rewards/engine";

/**
 * Stores Safe Quote validated sales in PostgreSQL (the single write path for sales).
 *
 * - `caseId` is the stable unique key: a sale is stored once, whatever delivers it
 *   (SSE, reconciliation or backfill) and however often.
 * - Agents are mapped by stable `userCode`.
 * - Reward eligibility is decided when a sale is FIRST stored and never changes:
 *     backfill                       → never eligible (historical import)
 *     sse / reconciliation, before the activation cutoff (or no cutoff) → not eligible
 *     sse / reconciliation, at/after the cutoff                         → eligible
 *   Only a newly stored eligible sale triggers automatic spins and bonuses, inside the
 *   same transaction. If anything fails, the whole thing rolls back and the next
 *   delivery (SSE retry or reconciliation) processes it again.
 * - Customer details are not stored: only case id, closer, state, carrier, coverage,
 *   premium and validation time (raw upstream payloads are not kept).
 */

export type SaleSource = "backfill" | "sse" | "reconciliation";

export interface IngestSaleInput {
  caseId: string;
  userCode: string;
  closerName?: string;
  state?: string;
  carrier?: string;
  coverage?: string | number;
  premium?: number;
  validatedAt: string;
  /** Upstream event id (SSE). Recorded in sales_events_inbox for replay protection. */
  eventId?: string | null;
  eventType?: string;
}

export interface IngestResult {
  status: "inserted" | "duplicate" | "invalid";
  saleId?: string;
  rewardEligible: boolean;
  spinGrants: AutoGrant[];
  bonuses: BonusAwardRecord[];
  error?: string;
}

export function normalizeUserCode(code: string): string {
  return code.trim().toUpperCase().slice(0, 60);
}

/** Agent primary key derived 1:1 from the (normalised, ≤60 char) userCode, so two codes can never collide. */
export function agentIdFor(userCode: string): string {
  return `agt_${userCode.slice(0, 60)}`;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2);
  return (s || "CL").toUpperCase().slice(0, 8);
}

export async function ingestValidatedSale(pool: Pool, input: IngestSaleInput, source: SaleSource): Promise<IngestResult> {
  const caseId = String(input.caseId ?? "").trim();
  const userCode = normalizeUserCode(String(input.userCode ?? ""));
  const validatedAt = new Date(input.validatedAt);
  if (!caseId || caseId.length > 128 || !userCode || Number.isNaN(validatedAt.getTime()))
    return { status: "invalid", rewardEligible: false, spinGrants: [], bonuses: [], error: "Missing caseId, userCode or validatedAt." };

  const closerName = (input.closerName || userCode).trim().slice(0, 128);
  const agentId = agentIdFor(userCode);
  const saleId = `sale_${caseId}`.slice(0, 64);
  const client = await pool.connect();
  let result: IngestResult;
  try {
    await client.query("BEGIN");

    if (input.eventId) {
      const ev = await client.query(
        `INSERT INTO sales_events_inbox (event_id, event_type, case_id, user_code, payload)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_id) DO NOTHING RETURNING id`,
        [input.eventId.slice(0, 128), input.eventType ?? "sale.validated", caseId, userCode,
          JSON.stringify({ caseId, userCode, validatedAt: validatedAt.toISOString(), source })],
      );
      if (!ev.rowCount) {
        const prev = await client.query(`SELECT processed FROM sales_events_inbox WHERE event_id = $1`, [input.eventId.slice(0, 128)]);
        if (prev.rows[0]?.processed) {
          await client.query("COMMIT");
          return { status: "duplicate", saleId, rewardEligible: false, spinGrants: [], bonuses: [] };
        }
      }
    }

    // Map the closer by stable userCode. Insert if new (no conflict target: safe under
    // concurrency), then keep the display name current when Safe Quote sends a real one.
    await client.query(
      `INSERT INTO agents (id, user_code, name, initials, active) VALUES ($1, $2, $3, $4, TRUE) ON CONFLICT DO NOTHING`,
      [agentId, userCode, closerName, initialsFor(closerName)],
    );
    if (closerName !== userCode) {
      await client.query(
        `UPDATE agents SET name = $2, initials = $3, updated_at = NOW() WHERE user_code = $1 AND name IS DISTINCT FROM $2`,
        [userCode, closerName, initialsFor(closerName)],
      );
    }

    const settings = await readSpinSettings(client);
    const cutoff = settings.activationCutoff;
    const rewardEligible = source !== "backfill" && cutoff !== null && validatedAt.getTime() >= cutoff.getTime();

    const ins = await client.query(
      `INSERT INTO validated_sales (id, case_id, user_code, agent_id, state, carrier, coverage, premium, validated_at,
                                   raw_payload, reward_processed, source, reward_eligible, closer_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, TRUE, $10, $11, $12, 'validated')
       ON CONFLICT (case_id) DO NOTHING RETURNING id`,
      [saleId, caseId, userCode, agentId, input.state?.slice(0, 8) || null, input.carrier?.slice(0, 64) || null,
        input.coverage !== undefined && input.coverage !== "" ? String(input.coverage).slice(0, 64) : null,
        Number.isFinite(Number(input.premium)) ? Number(input.premium) : 0, validatedAt, source, rewardEligible, closerName],
    );
    const inserted = Boolean(ins.rowCount);
    let spinGrants: AutoGrant[] = [];
    let bonuses: BonusAwardRecord[] = [];

    if (inserted) {
      await client.query(
        `INSERT INTO sale_status_history (case_id, status, source, event_id) VALUES ($1, 'validated', $2, $3) ON CONFLICT DO NOTHING`,
        [caseId, source, input.eventId?.slice(0, 128) ?? null],
      );
      if (rewardEligible && cutoff) {
        const calendar = businessCalendar();
        spinGrants = await grantAutomaticSpins(client, { userCode, triggerSaleId: saleId, validatedAt, calendar });
        bonuses = await evaluateBonusAwards(client, { userCode, agentId, closerName, saleId, validatedAt, cutoff, calendar });
      }
    }
    if (input.eventId) {
      await client.query(`UPDATE sales_events_inbox SET processed = TRUE, processed_at = NOW(), error = NULL WHERE event_id = $1`, [input.eventId.slice(0, 128)]);
    }
    await client.query("COMMIT");
    result = { status: inserted ? "inserted" : "duplicate", saleId, rewardEligible: inserted && rewardEligible, spinGrants, bonuses };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Broadcast only after the data is committed.
  if (result.status === "inserted") {
    arenaBroadcaster.broadcast("sale.validated", { caseId, userCode, closerName, validatedAt: validatedAt.toISOString() });
    if (result.spinGrants.length) {
      const last = result.spinGrants[result.spinGrants.length - 1];
      arenaBroadcaster.broadcast("spin.unlocked", {
        eventId: `tx:${last.transactionId}`,
        origin: "automatic",
        userCode,
        closerName,
        quantity: result.spinGrants.reduce((n, g) => n + g.quantity, 0),
        salesCounted: last.salesCounted,
        spinsAvailable: last.balanceAfter,
      });
    }
    for (const b of result.bonuses) arenaBroadcaster.broadcast("bonus.awarded", { awardId: b.id, closer: { userCode, name: closerName }, amount: b.amount, prizeLabel: b.prizeLabel, programName: b.programName, kind: b.kind });
  }
  return result;
}

/** A later status change (returned / rejected) for a stored sale. Past grants stay in the ledger; future counts exclude it. */
export async function recordSaleStatus(
  pool: Pool,
  args: { caseId: string; status: "returned" | "rejected" | "validated"; source: SaleSource; eventId?: string | null },
): Promise<"updated" | "unknown_sale" | "unchanged"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(`SELECT status FROM validated_sales WHERE case_id = $1 FOR UPDATE`, [args.caseId]);
    if (!cur.rowCount) {
      await client.query("ROLLBACK");
      return "unknown_sale";
    }
    if (cur.rows[0].status === args.status) {
      await client.query("ROLLBACK");
      return "unchanged";
    }
    await client.query(`UPDATE validated_sales SET status = $2 WHERE case_id = $1`, [args.caseId, args.status]);
    await client.query(
      `INSERT INTO sale_status_history (case_id, status, source, event_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [args.caseId, args.status, args.source, args.eventId ?? null],
    );
    await client.query("COMMIT");
    return "updated";
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
