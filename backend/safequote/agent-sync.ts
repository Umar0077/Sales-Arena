import type { Pool } from "pg";
import { getSafeQuoteClient } from "./client";
import type { SafeQuoteCloserItem } from "./schemas";
import { agentIdFor, initialsFor, normalizeUserCode } from "../sales/ingest";

/**
 * Verified SafeQuote → PostgreSQL `agents` directory synchronization.
 *
 * Guarantees:
 *  - Matches strictly by normalized `user_code` (never by display name alone).
 *  - Creates missing `agents` rows ONLY when a verified upstream `userCode` exists (never invents codes).
 *  - Preserves all existing `agents` records, spin eligibility flags, emojis, and historical data.
 *  - Never creates duplicate users (`agents.id` PK and `agents.user_code` UNIQUE + ON CONFLICT DO NOTHING).
 *  - Never assigns `agents.team_id` or creates unverified `team_memberships` rows automatically.
 *  - Preserves all historical `team_memberships` untouched.
 */

export interface AgentSyncResult {
  discovered: number;
  created: number;
  namesBackfilled: number;
  createdCodes: string[];
  safeQuote: "ok" | "skipped" | "unavailable";
}

const SYNC_KEY = Symbol.for("sales_arena.agent_sync_state");
const THROTTLE_MS = 15_000;
const g = globalThis as unknown as {
  [SYNC_KEY]?: { lastAt: number; inflight: Promise<AgentSyncResult> | null };
};
const state = (g[SYNC_KEY] ??= { lastAt: 0, inflight: null });

function isVerifiedIdentity(rawCode: unknown, rawName: unknown): { userCode: string; name: string } | null {
  if (typeof rawCode !== "string") return null;
  const userCode = normalizeUserCode(rawCode);
  if (!userCode || userCode.length < 2) return null;
  const trimmedName = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ").slice(0, 128) : "";
  // Skip synthetic upstream test rows or placeholder unknowns without a real name.
  if (!trimmedName || trimmedName.toLowerCase() === "unknown" || /^test\b/i.test(trimmedName)) return null;
  return { userCode, name: trimmedName };
}

export async function syncVerifiedClosers(
  pool: Pool | null | undefined,
  opts: { closers?: SafeQuoteCloserItem[]; fresh?: boolean } = {},
): Promise<AgentSyncResult> {
  if (!pool || typeof pool.connect !== "function") {
    return { discovered: 0, created: 0, namesBackfilled: 0, createdCodes: [], safeQuote: "skipped" };
  }

  const hasExplicitClosers = Array.isArray(opts.closers);
  if (!hasExplicitClosers && !opts.fresh) {
    if (state.inflight) return state.inflight;
    if (Date.now() - state.lastAt < THROTTLE_MS) {
      return { discovered: 0, created: 0, namesBackfilled: 0, createdCodes: [], safeQuote: "skipped" };
    }
  }

  const run = async (): Promise<AgentSyncResult> => {
    const byCode = new Map<string, string>();
    let safeQuote: AgentSyncResult["safeQuote"] = "skipped";

    if (hasExplicitClosers) {
      safeQuote = "ok";
      for (const c of opts.closers!) {
        const id = isVerifiedIdentity(c.userCode, c.name);
        if (id && !byCode.has(id.userCode)) byCode.set(id.userCode, id.name);
      }
    } else {
      const sq = getSafeQuoteClient();
      if (sq.isConfigured()) {
        try {
          const res = await sq.getClosers(undefined, opts.fresh === true);
          safeQuote = "ok";
          for (const c of res.closers) {
            const id = isVerifiedIdentity(c.userCode, c.name);
            if (id && !byCode.has(id.userCode)) byCode.set(id.userCode, id.name);
          }
        } catch {
          safeQuote = "unavailable";
        }
      }
    }

    // Also include any verified user_code already stored in validated_sales whose agents row may be missing.
    try {
      const salesClosers = await pool.query<{ user_code: string; closer_name: string | null }>(
        `SELECT DISTINCT ON (UPPER(TRIM(s.user_code))) UPPER(TRIM(s.user_code)) AS user_code, s.closer_name
           FROM validated_sales s
           LEFT JOIN agents a ON a.user_code = UPPER(TRIM(s.user_code))
          WHERE a.user_code IS NULL AND s.user_code IS NOT NULL AND TRIM(s.user_code) <> ''
          ORDER BY UPPER(TRIM(s.user_code)), s.validated_at DESC`,
      );
      for (const r of salesClosers.rows) {
        const id = isVerifiedIdentity(r.user_code, r.closer_name || r.user_code);
        if (id && !byCode.has(id.userCode)) byCode.set(id.userCode, id.name);
      }
    } catch {
      // Non-fatal if run before schema initialization.
    }

    if (byCode.size === 0) {
      if (!hasExplicitClosers) state.lastAt = Date.now();
      return { discovered: 0, created: 0, namesBackfilled: 0, createdCodes: [], safeQuote };
    }

    const client = await pool.connect();
    const createdCodes: string[] = [];
    let namesBackfilled = 0;
    try {
      await client.query("BEGIN");
      for (const [userCode, name] of byCode.entries()) {
        const ins = await client.query<{ user_code: string }>(
          `INSERT INTO agents (id, user_code, name, initials, active)
           VALUES ($1, $2, $3, $4, TRUE)
           ON CONFLICT DO NOTHING
           RETURNING user_code`,
          [agentIdFor(userCode), userCode, name, initialsFor(name)],
        );
        if (ins.rowCount) {
          createdCodes.push(userCode);
        } else if (name !== userCode) {
          // Only backfill a placeholder code-as-name; preserve existing customized/verified agent names.
          const upd = await client.query(
            `UPDATE agents
                SET name = $2, initials = $3, updated_at = NOW()
              WHERE user_code = $1 AND name = user_code`,
            [userCode, name, initialsFor(name)],
          );
          namesBackfilled += upd.rowCount ?? 0;
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    if (!hasExplicitClosers) state.lastAt = Date.now();
    return {
      discovered: byCode.size,
      created: createdCodes.length,
      namesBackfilled,
      createdCodes,
      safeQuote,
    };
  };

  if (!hasExplicitClosers && !opts.fresh) {
    const p = run().finally(() => {
      if (state.inflight === p) state.inflight = null;
    });
    state.inflight = p;
    return p;
  }
  return run();
}

export function __resetAgentSyncThrottle(): void {
  state.lastAt = 0;
  state.inflight = null;
}
