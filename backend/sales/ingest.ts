import type { Pool } from "pg";
import { arenaBroadcaster } from "../events/broadcaster";
import { traceBroadcast } from "./delivery-trace";

/** A sale stored this long after Safe Quote validated it is logged as a slow discovery. */
const SLOW_DISCOVERY_SEC = 60;
import { grantAutomaticSpins, readSpinSettings, type AutoGrant } from "../spins/ledger";
import { calendarFrom, readArenaConfig } from "../settings/arena-config";
import { evaluateBonusAwards, type BonusAwardRecord } from "../rewards/engine";
import { teamForSale } from "../teams/attribution";
import type { BusinessClock } from "@/shared/time/business";

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

export function initialsFor(name: string): string {
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
  let firstSeenAt: string | null = null;
  let clock: BusinessClock | undefined;
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
       ON CONFLICT (case_id) DO NOTHING RETURNING id, first_seen_at`,
      [saleId, caseId, userCode, agentId, input.state?.slice(0, 8) || null, input.carrier?.slice(0, 64) || null,
        input.coverage !== undefined && input.coverage !== "" ? String(input.coverage).slice(0, 64) : null,
        Number.isFinite(Number(input.premium)) ? Number(input.premium) : 0, validatedAt, source, rewardEligible, closerName],
    );
    const inserted = Boolean(ins.rowCount);
    firstSeenAt = inserted ? new Date(ins.rows[0].first_seen_at).toISOString() : null;
    let spinGrants: AutoGrant[] = [];
    let bonuses: BonusAwardRecord[] = [];

    if (inserted) {
      await client.query(
        `INSERT INTO sale_status_history (case_id, status, source, event_id) VALUES ($1, 'validated', $2, $3) ON CONFLICT DO NOTHING`,
        [caseId, source, input.eventId?.slice(0, 128) ?? null],
      );
      // Every NEW live sale (SSE / reconciliation) goes to the bonus engine. Historical imports (backfill)
      // never do. Bonus earning is controlled by each program's Program Active switch and activation time
      // (sales validated before it never count); the spin activation cutoff, when set, is an extra floor.
      // Before this fix bonuses also required the spin cutoff (reward_eligible), so with no cutoff set no
      // bonus program could ever award even while shown as Active in Admin.
      if (source !== "backfill") {
        const cfg = (await readArenaConfig(client)).values;
        const calendar = calendarFrom(cfg);
        clock = calendar;
        const config = {
          categories: cfg.rewardCategories as Record<string, { active: boolean; showOnArena: boolean }>,
          arenaEnabled: cfg.arenaEnabled !== false,
          celebrationPopups: cfg.celebrationPopups !== false,
          announceCash: cfg.announceCash !== false,
          announcePrizes: cfg.announcePrizes !== false,
        };
        // Spin credits: unchanged (automatic spins need the activation cutoff, i.e. reward_eligible).
        if (rewardEligible && cutoff) spinGrants = await grantAutomaticSpins(client, { userCode, triggerSaleId: saleId, validatedAt, calendar });
        bonuses = await evaluateBonusAwards(client, { userCode, agentId, closerName, saleId, caseId, validatedAt, cutoff, calendar, config });
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
    // `source` lets displays tell a live sale from a historical import (Arena Cub never celebrates imports).
    // Delivery timeline: validatedAt (Safe Quote) → firstSeenAt (received here) → storedAt (committed) → broadcastAt.
    const storedAt = new Date().toISOString();
    // Teams Arena presentation only: the team on the sale's business day, by user_code (one indexed read-only
    // query AFTER the commit, so it can never block or undo the sale). A failed lookup leaves `team` out and
    // displays fall back to the existing sale popup; null means the agent had no team that day.
    let team: Awaited<ReturnType<typeof teamForSale>> | undefined;
    try {
      team = await teamForSale(pool, userCode, validatedAt, clock);
    } catch {
      team = undefined;
    }
    const saleBroadcastAt = new Date().toISOString();
    traceBroadcast("sale", caseId, { source, validatedAt: validatedAt.toISOString(), firstSeenAt, storedAt, broadcastAt: saleBroadcastAt });
    arenaBroadcaster.broadcast("sale.validated", {
      caseId, userCode, closerName, validatedAt: validatedAt.toISOString(), source, firstSeenAt, storedAt, broadcastAt: saleBroadcastAt,
      ...(team !== undefined ? { team } : {}),
    });
    // Slow discovery (Safe Quote validated it long before this server learned of it): logged once, no customer data.
    const discoverySec = firstSeenAt ? (new Date(firstSeenAt).getTime() - validatedAt.getTime()) / 1000 : 0;
    if (source !== "backfill" && discoverySec > SLOW_DISCOVERY_SEC)
      console.warn(`[sales-delivery] slow discovery: case ${caseId} stored ${Math.round(discoverySec)}s after Safe Quote validated it (source ${source})`);
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
    // One event per committed award row (the displays dedupe by awardId).
    for (const b of result.bonuses) {
      const broadcastAt = new Date().toISOString();
      traceBroadcast("award", b.id, { source, validatedAt: validatedAt.toISOString(), firstSeenAt, storedAt, broadcastAt });
      arenaBroadcaster.broadcast("rewards.award.created", { award: publicAward(b, userCode, closerName), validatedAt: validatedAt.toISOString(), source, firstSeenAt, broadcastAt });
    }
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

/** What the Live Arena may show about an award: agent name, reward and sales count. No customer data. */
export function publicAward(b: BonusAwardRecord, userCode: string, agentName: string) {
  return {
    id: b.id,
    programId: b.programId,
    programName: b.programName,
    kind: b.kind,
    rewardType: b.rewardType,
    agentId: agentIdFor(userCode),
    userCode,
    agentName,
    periodKey: b.periodKey,
    n: b.n,
    validatedAtAward: b.validatedCount,
    salesRequired: b.salesRequired,
    amount: b.amount,
    currency: b.currency,
    prizeLabel: b.prizeLabel,
    announce: b.announce,
    // Tier upgrade: amount is the new TOTAL entitlement; incrementAmount is the increase over the previous tier.
    upgrade: b.upgrade,
    previousAmount: b.previousAmount,
    incrementAmount: b.incrementAmount,
    createdAt: b.createdAt,
  };
}
