import type { Pool, PoolClient } from "pg";

/**
 * Login throttling, stored in PostgreSQL so it survives restarts and works across
 * processes. Counts failed attempts in a sliding window per email hash and per IP.
 */
export const LOGIN_WINDOW_MINUTES = 15;
export const MAX_FAILS_PER_EMAIL = 5;
export const MAX_FAILS_PER_IP = 20;

export async function isLoginBlocked(db: Pool | PoolClient, emailHash: string, ip: string | null): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE email_hash = $1) AS by_email,
       COUNT(*) FILTER (WHERE $2::varchar IS NOT NULL AND ip_address = $2) AS by_ip
     FROM admin_login_attempts
     WHERE success = FALSE AND created_at > NOW() - ($3 || ' minutes')::interval
       AND (email_hash = $1 OR ($2::varchar IS NOT NULL AND ip_address = $2))`,
    [emailHash, ip, String(LOGIN_WINDOW_MINUTES)],
  );
  const r = rows[0] ?? { by_email: 0, by_ip: 0 };
  return Number(r.by_email) >= MAX_FAILS_PER_EMAIL || Number(r.by_ip) >= MAX_FAILS_PER_IP;
}

export async function recordLoginAttempt(db: Pool | PoolClient, emailHash: string, ip: string | null, success: boolean): Promise<void> {
  await db.query(`INSERT INTO admin_login_attempts (email_hash, ip_address, success) VALUES ($1, $2, $3)`, [emailHash, ip, success]);
  // Keep the table small: drop entries older than a day (cheap, indexed).
  if (Math.random() < 0.05) await db.query(`DELETE FROM admin_login_attempts WHERE created_at < NOW() - INTERVAL '1 day'`);
}
