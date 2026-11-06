import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { writeAudit } from "../auth/guard";
import { arenaBroadcaster } from "../events/broadcaster";
import { readArenaConfig } from "../settings/arena-config";
import { registerCommand } from "./acks";
import { readCub } from "@/shared/cub/config";
import { CUB_COMMAND_TTL_MS, isCubCommand, type CubCommand, type CubTarget } from "@/shared/cub/actions";

/**
 * Live Arena Cub actions from Admin. Only an action name from the fixed allowlist and a target are
 * accepted (never code, CSS or markup). Each command gets a unique id and an expiry, is written to the
 * audit log with the admin's identity, then broadcast on the existing SSE stream. Nothing financial is
 * read or written: no sale, award or spin is created.
 */

export class CubCommandError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

/** Per-admin limits: one command per second, 30 per minute. The live greeting: once per 15 s for everyone. */
export const CUB_RATE = { minGapMs: 1000, perMinute: 30, greetCooldownMs: 15_000 };
const recent = new Map<string, number[]>();
let lastGreetAt = 0;

/** Test hook. */
export function __resetCubRate() {
  recent.clear();
  lastGreetAt = 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function parseTarget(pool: Pool, raw: unknown): Promise<CubTarget> {
  if (raw === undefined || raw === null) return { scope: "all" };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new CubCommandError(400, "Choose where the action should play.");
  const t = raw as Record<string, unknown>;
  if (t.scope === "all") return { scope: "all" };
  if (t.scope === "screen") {
    if (t.screen === "daily" || t.screen === "weekly" || t.screen === "monthly") return { scope: "screen", screen: t.screen };
    throw new CubCommandError(400, "Choose the Daily, Weekly or Monthly Arena.");
  }
  if (t.scope === "devices") {
    const ids = t.devices;
    if (!Array.isArray(ids) || !ids.length || ids.length > 25 || ids.some((d) => typeof d !== "string" || !UUID.test(d)))
      throw new CubCommandError(400, "Choose between 1 and 25 paired displays.");
    // Only paired, unrevoked displays can be targeted (trusted identity, no invented devices).
    const { rows } = await pool.query(`SELECT id FROM arena_devices WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL AND paired_at IS NOT NULL`, [ids]);
    if (rows.length !== new Set(ids).size) throw new CubCommandError(400, "One or more selected displays are not paired (or were revoked).");
    return { scope: "devices", devices: [...new Set(ids as string[])] };
  }
  throw new CubCommandError(400, "Unknown target.");
}

export async function sendCubCommand(
  pool: Pool,
  body: unknown,
  actor: { adminId: string; ip: string | null; userAgent: string | null },
  now = Date.now(),
): Promise<CubCommand> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CubCommandError(400, "Invalid request.");
  if (JSON.stringify(body).length > 2048) throw new CubCommandError(413, "Request too large.");
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (k !== "action" && k !== "target") throw new CubCommandError(400, `"${k}" is not allowed.`);
  if (!isCubCommand(b.action)) throw new CubCommandError(400, "Unknown Arena Cub action.");
  const action = b.action;

  const cub = readCub((await readArenaConfig(pool)).values.arenaCub);
  if (!cub.allowOnLiveArena) throw new CubCommandError(409, 'Arena Cub is not allowed on the Live Arena. Turn on "Allow Arena Cub on Live Arena" first.');
  if (!cub.enabled) throw new CubCommandError(409, "Arena Cub is switched off.");
  const target = await parseTarget(pool, b.target);

  // Rate limits (per admin) and the greeting cooldown (shared).
  const list = (recent.get(actor.adminId) ?? []).filter((t) => now - t < 60_000);
  const last = list[list.length - 1];
  if (last !== undefined && now - last < CUB_RATE.minGapMs) throw new CubCommandError(429, "Too fast: wait a moment between actions.", 1);
  if (list.length >= CUB_RATE.perMinute) throw new CubCommandError(429, "Too many actions this minute.", Math.ceil((60_000 - (now - list[0])) / 1000));
  if (action === "greet" && now - lastGreetAt < CUB_RATE.greetCooldownMs)
    throw new CubCommandError(429, "The greeting was just played. Try again in a few seconds.", Math.ceil((CUB_RATE.greetCooldownMs - (now - lastGreetAt)) / 1000));

  const cmd: CubCommand = { id: randomUUID(), action, target, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + CUB_COMMAND_TTL_MS).toISOString() };
  await writeAudit(pool, {
    adminId: actor.adminId,
    action: "arena_cub.command",
    targetType: "arena_cub",
    targetId: cmd.id,
    details: { action, target, issuedAt: cmd.issuedAt, expiresAt: cmd.expiresAt },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  list.push(now);
  recent.set(actor.adminId, list);
  if (action === "greet") lastGreetAt = now;
  registerCommand(cmd.id, action, now); // displays report started / completed against this id
  arenaBroadcaster.broadcast("arena.cub.action", cmd);
  return cmd;
}
