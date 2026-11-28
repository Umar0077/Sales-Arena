import { randomInt, randomUUID } from "crypto";
import type { Pool } from "pg";
import { applyLedgerEntry, lockBalance, SpinError } from "./ledger";
import { arenaBroadcaster } from "../events/broadcaster";

export interface WheelSegment {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
}

export interface SpinOutcome {
  replayed: boolean;
  spinId: string;
  reward: WheelSegment;
  /** Index of the winning prize in `segments` — the wheel animates to exactly this. */
  segmentIndex: number;
  segments: WheelSegment[];
  availableLeft: number;
}

/** Active prizes the wheel shows, in display order (out-of-stock prizes are left off). */
export async function loadWheelSegments(pool: Pool): Promise<WheelSegment[]> {
  const { rows } = await pool.query(
    `SELECT id, title, description, icon, color FROM rewards_catalog
      WHERE active AND weight > 0 AND (quantity IS NULL OR quantity > 0)
      ORDER BY display_order, id`,
  );
  return rows;
}

/** Weighted pick using a cryptographic RNG. */
export function weightedPick<T extends { weight: number | string }>(items: T[]): number {
  const weights = items.map((i) => Math.max(0, Math.round(Number(i.weight) * 10000)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let roll = randomInt(total);
  for (let i = 0; i < weights.length; i++) {
    if (roll < weights[i]) return i;
    roll -= weights[i];
  }
  return weights.length - 1;
}

/**
 * Consumes one spin and picks the prize on the server.
 * - Locks the agent's balance row: parallel requests queue; the balance can't go below 0.
 * - `idempotencyKey` (from the client, one per spin attempt): a retry returns the same result.
 * - Prize rows are locked while choosing, so limited stock can't be oversold.
 */
export async function executeSpin(
  pool: Pool,
  args: { userCode: string; idempotencyKey: string; actor: string; claimOnly?: boolean },
): Promise<SpinOutcome> {
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(args.idempotencyKey)) throw new SpinError("invalid_input", "Missing or invalid spin request key.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const bal = await lockBalance(client, args.userCode);

    const prior = await client.query(`SELECT * FROM spin_results WHERE idempotency_key = $1`, [args.idempotencyKey]);
    if (prior.rowCount) {
      const r = prior.rows[0];
      if (r.user_code !== args.userCode) throw new SpinError("conflict", "This spin request key belongs to another agent.");
      await client.query("COMMIT");
      const snap = r.reward_snapshot ?? {};
      return {
        replayed: true,
        spinId: r.id,
        reward: { id: r.reward_id, title: r.reward_title, description: snap.reward?.description ?? "", icon: r.reward_icon, color: r.reward_color },
        segmentIndex: r.segment_index,
        segments: snap.segments ?? [],
        availableLeft: Number(bal.available),
      };
    }
    if (Number(bal.available) < 1) throw new SpinError("insufficient_credits", "No spins available.");

    const prizes = (
      await client.query(
        `SELECT id, title, description, icon, color, weight, quantity FROM rewards_catalog
          WHERE active AND weight > 0 AND (quantity IS NULL OR quantity > 0)
          ORDER BY display_order, id FOR UPDATE`,
      )
    ).rows;
    if (!prizes.length) throw new SpinError("no_prizes", "No prizes are available on the wheel. Add prizes in Admin → Spin Management.");

    const idx = weightedPick(prizes);
    const won = prizes[idx];
    if (won.quantity !== null) {
      await client.query(`UPDATE rewards_catalog SET quantity = quantity - 1, updated_at = NOW() WHERE id = $1 AND quantity > 0`, [won.id]);
    }
    const segments: WheelSegment[] = prizes.map((p) => ({ id: p.id, title: p.title, description: p.description, icon: p.icon, color: p.color }));
    const spinId = `spin_${randomUUID()}`;
    const initialStatus = args.claimOnly ? "in-progress" : "completed";
    const completedAt = new Date();
    await client.query(
      `INSERT INTO spin_results (id, user_code, agent_id, reward_id, reward_title, reward_color, reward_icon, status, mode, segment_index,
                                 idempotency_key, actor, reward_snapshot, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'server', $9, $10, $11, $12, $13)`,
      [spinId, args.userCode, bal.agent_id, won.id, won.title, won.color, won.icon, initialStatus, idx, args.idempotencyKey, args.actor,
        JSON.stringify({ reward: segments[idx], segments }), completedAt],
    );
    const led = await applyLedgerEntry(client, {
      userCode: args.userCode,
      kind: "consume",
      quantity: -1,
      idempotencyKey: `consume:${spinId}`,
      spinResultId: spinId,
    });
    await client.query("COMMIT");
    return { replayed: false, spinId, reward: segments[idx], segmentIndex: idx, segments, availableLeft: led.balanceAfter };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Finalizes an 'in-progress' spin to 'completed'. Idempotent: if already completed,
 * returns replayed: true without modifying anything or generating a second prize.
 */
export async function completeSpin(
  pool: Pool,
  args: { spinId: string },
): Promise<{
  replayed: boolean;
  spinId: string;
  userCode: string;
  reward: WheelSegment;
  availableLeft: number;
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{
      id: string;
      user_code: string;
      reward_id: string;
      reward_title: string;
      reward_color: string;
      reward_icon: string;
      status: string;
      reward_snapshot: { reward?: WheelSegment } | null;
    }>(`SELECT id, user_code, reward_id, reward_title, reward_color, reward_icon, status, reward_snapshot FROM spin_results WHERE id = $1 FOR UPDATE`, [args.spinId]);
    if (!cur.rowCount) throw new SpinError("invalid_input", "Spin record not found.");
    const r = cur.rows[0];
    const replayed = r.status === "completed";
    if (!replayed) {
      await client.query(`UPDATE spin_results SET status = 'completed', completed_at = NOW() WHERE id = $1`, [args.spinId]);
    }
    const bal = await client.query<{ available: number }>(`SELECT available FROM spin_credits WHERE user_code = $1`, [r.user_code]);
    await client.query("COMMIT");
    return {
      replayed,
      spinId: r.id,
      userCode: r.user_code,
      reward: {
        id: r.reward_id,
        title: r.reward_title,
        description: r.reward_snapshot?.reward?.description ?? "",
        icon: r.reward_icon,
        color: r.reward_color,
      },
      availableLeft: Number(bal.rows[0]?.available ?? 0),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Recovers stale 'in-progress' spins (e.g. if a TV browser crashed, lost network, or the
 * server restarted before POST /api/arena/spin/complete arrived). Because the credit was
 * already atomically claimed and the prize server-selected, finalizing it preserves the
 * exact prize without losing the credit or generating a duplicate.
 */
export async function recoverStaleSpins(
  pool: Pool,
  maxAgeSeconds = 90,
): Promise<Array<{ spinId: string; userCode: string; rewardTitle: string; availableLeft: number }>> {
  const secs = Math.max(5, Math.floor(maxAgeSeconds));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      id: string;
      user_code: string;
      reward_id: string | null;
      reward_title: string;
      reward_color: string;
      reward_icon: string;
      reward_snapshot: { reward?: WheelSegment } | null;
    }>(
      `UPDATE spin_results
          SET status = 'completed', completed_at = NOW()
        WHERE id IN (
          SELECT id FROM spin_results
           WHERE status = 'in-progress'
             AND created_at <= NOW() - make_interval(secs => $1)
           FOR UPDATE SKIP LOCKED
        )
       RETURNING id, user_code, reward_id, reward_title, reward_color, reward_icon, reward_snapshot`,
      [secs],
    );
    const out: Array<{ spinId: string; userCode: string; rewardTitle: string; availableLeft: number }> = [];
    for (const r of rows) {
      const bal = await client.query<{ available: number }>(`SELECT available FROM spin_credits WHERE user_code = $1`, [r.user_code]);
      const availableLeft = Number(bal.rows[0]?.available ?? 0);
      out.push({ spinId: r.id, userCode: r.user_code, rewardTitle: r.reward_title, availableLeft });
    }
    await client.query("COMMIT");

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      arenaBroadcaster.broadcast("spin.completed", {
        spinId: r.id,
        userCode: r.user_code,
        reward: {
          id: r.reward_id ?? r.id,
          title: r.reward_title,
          description: r.reward_snapshot?.reward?.description ?? "",
          icon: r.reward_icon,
          color: r.reward_color,
        },
        availableLeft: out[i].availableLeft,
      });
    }
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
