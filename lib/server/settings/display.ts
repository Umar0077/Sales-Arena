import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { arenaBroadcaster } from "../events/broadcaster";

/**
 * Global display policy for every Live Arena screen, stored in admin_settings (PostgreSQL).
 * Browsers only cache it; this row is the authority.
 */

export type GlobalPerformanceMode = "auto" | "high" | "performance";
export const PERFORMANCE_MODES: GlobalPerformanceMode[] = ["auto", "high", "performance"];
const KEY = "display.performance_mode";

export interface GlobalDisplaySettings {
  performanceMode: GlobalPerformanceMode;
  /** Increases by 1 on every change; displays apply only newer revisions. */
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface Stored {
  mode: GlobalPerformanceMode;
  revision: number;
  updatedAt: string;
  updatedBy: string | null;
}

export async function readGlobalDisplay(db: Pool | PoolClient): Promise<GlobalDisplaySettings> {
  const { rows } = await db.query(
    `SELECT s.value, u.email FROM admin_settings s LEFT JOIN admin_users u ON u.id::text = s.value->>'updatedBy' WHERE s.key = $1`,
    [KEY],
  );
  const v = rows[0]?.value as Stored | undefined;
  if (!v || !PERFORMANCE_MODES.includes(v.mode)) return { performanceMode: "auto", revision: 0, updatedAt: null, updatedBy: null };
  return { performanceMode: v.mode, revision: Number(v.revision) || 0, updatedAt: v.updatedAt ?? null, updatedBy: rows[0].email ?? null };
}

export class DisplaySettingsError extends Error {}

/** Saves the global mode (transaction + row lock + audit), then broadcasts it to all displays. */
export async function saveGlobalPerformanceMode(
  pool: Pool,
  mode: unknown,
  actor: { adminId: string; ip: string | null; userAgent: string | null },
): Promise<GlobalDisplaySettings> {
  if (typeof mode !== "string" || !PERFORMANCE_MODES.includes(mode as GlobalPerformanceMode))
    throw new DisplaySettingsError("Choose Auto, High Quality or Performance.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Make sure the row exists, then lock it so concurrent saves get consecutive revisions.
    await client.query(`INSERT INTO admin_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [
      KEY,
      JSON.stringify({ mode: "auto", revision: 0, updatedAt: new Date(0).toISOString(), updatedBy: null }),
    ]);
    const cur = (await client.query(`SELECT value FROM admin_settings WHERE key = $1 FOR UPDATE`, [KEY])).rows[0].value as Stored;
    const next: Stored = { mode: mode as GlobalPerformanceMode, revision: (Number(cur.revision) || 0) + 1, updatedAt: new Date().toISOString(), updatedBy: actor.adminId };
    await client.query(`UPDATE admin_settings SET value = $2, updated_at = NOW() WHERE key = $1`, [KEY, JSON.stringify(next)]);
    await writeAudit(client, {
      adminId: actor.adminId,
      action: "settings.performance_mode",
      targetType: "admin_setting",
      targetId: KEY,
      details: { from: cur.mode, to: next.mode, revision: next.revision },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const saved = await readGlobalDisplay(pool);
  // Only after commit: every connected display applies it over the shared stream.
  arenaBroadcaster.broadcast("settings.performance.updated", { mode: saved.performanceMode, revision: saved.revision });
  return saved;
}
