import { randomInt, randomUUID } from "crypto";
import type { Pool } from "pg";
import { applyLedgerEntry, lockBalance, SpinError } from "./ledger";

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
  const weights = items.map((i) => Math.max(0, Math.round(Number(i.weight) * 100)));
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
export async function executeSpin(pool: Pool, args: { userCode: string; idempotencyKey: string; actor: string }): Promise<SpinOutcome> {
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
    await client.query(
      `INSERT INTO spin_results (id, user_code, agent_id, reward_id, reward_title, reward_color, reward_icon, status, mode, segment_index,
                                 idempotency_key, actor, reward_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'server', $8, $9, $10, $11)`,
      [spinId, args.userCode, bal.agent_id, won.id, won.title, won.color, won.icon, idx, args.idempotencyKey, args.actor,
        JSON.stringify({ reward: segments[idx], segments })],
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
