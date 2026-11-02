import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDbPool } from "../db/client";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "./broadcaster";

/**
 * Optional cross-process event delivery (SALES_ARENA_EVENT_BUS=postgres) for when more than one
 * Node process serves the arena. Every broadcast is also sent with PostgreSQL NOTIFY; each process
 * LISTENs and re-delivers events from other processes to its own SSE clients. With a single process
 * (the default) nothing changes. Events too large for NOTIFY are skipped: the displays' 3-minute
 * reconciliation still picks those changes up.
 */

const CHANNEL = "sales_arena_events";
const ORIGIN = randomUUID();
const MAX_PAYLOAD = 7500;
let started = false;
let client: PoolClient | null = null;

export function crossProcessEnabled() {
  return process.env.SALES_ARENA_EVENT_BUS === "postgres";
}

export async function startPgEventBus(): Promise<void> {
  if (started || !crossProcessEnabled()) return;
  const pool = getDbPool();
  if (!pool) return;
  started = true;
  arenaBroadcaster.setRelay((e: ArenaBroadcastEvent) => {
    const msg = JSON.stringify({ o: ORIGIN, t: e.type, p: e.payload });
    if (msg.length > MAX_PAYLOAD) return;
    pool.query(`SELECT pg_notify($1, $2)`, [CHANNEL, msg]).catch(() => {});
  });
  const connect = async () => {
    try {
      client = await pool.connect();
      client.on("notification", (n) => {
        try {
          const m = JSON.parse(n.payload ?? "{}");
          if (m.o !== ORIGIN && m.t) arenaBroadcaster.deliverLocal(m.t, m.p);
        } catch {
          /* ignore malformed */
        }
      });
      client.on("error", () => {
        client?.release(true);
        client = null;
        setTimeout(() => void connect(), 5000);
      });
      await client.query(`LISTEN ${CHANNEL}`);
    } catch {
      client = null;
      setTimeout(() => void connect(), 5000);
    }
  };
  await connect();
}
