import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { PoolClient } from "pg";
import { getDbPool } from "../db/client";

/**
 * Database-backed admin sessions.
 * The browser holds a random 256-bit token in an HttpOnly cookie; the database stores
 * only its SHA-256, so a database leak does not reveal usable sessions.
 */

export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000; // hard limit: 12 hours
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000; // idle timeout: 2 hours
const TOUCH_EVERY_MS = 60 * 1000;

/** Secure cookies everywhere except plain-HTTP development, or an explicit staging override. */
export function secureCookiesEnabled(): boolean {
  if (process.env.ADMIN_COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

/** `__Host-` prefix forces Secure, Path=/ and no Domain in the browser. */
export function sessionCookieName(): string {
  return secureCookiesEnabled() ? "__Host-sa_admin" : "sa_admin";
}

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** CSRF token bound to the session token. A cross-site page cannot read the HttpOnly cookie, so it cannot compute it. */
export function csrfTokenFor(sessionToken: string): string {
  return createHash("sha256").update(`csrf:${sessionToken}`).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface AdminIdentity {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "admin";
}

export interface SessionContext {
  admin: AdminIdentity;
  sessionId: string;
  token: string;
}

export async function createSession(
  client: PoolClient,
  adminId: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_ABSOLUTE_MS);
  await client.query(
    `INSERT INTO admin_sessions (id, admin_id, expires_at, idle_expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sha256(token), adminId, expiresAt, new Date(now + SESSION_IDLE_MS), meta.ip, meta.userAgent?.slice(0, 256) ?? null],
  );
  return { token, expiresAt };
}

/** Valid, unexpired, unrevoked session for an active admin; slides the idle timeout. */
export async function readSession(token: string | undefined | null): Promise<SessionContext | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const pool = getDbPool();
  if (!pool) return null;
  const id = sha256(token);
  const { rows } = await pool.query(
    `SELECT s.id, s.last_seen_at, u.id AS admin_id, u.email, u.display_name, u.role
       FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND s.idle_expires_at > NOW() AND u.is_active`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  if (Date.now() - new Date(r.last_seen_at).getTime() > TOUCH_EVERY_MS) {
    await pool.query(
      `UPDATE admin_sessions SET last_seen_at = NOW(), idle_expires_at = LEAST(expires_at, NOW() + ($2 || ' milliseconds')::interval) WHERE id = $1`,
      [id, String(SESSION_IDLE_MS)],
    );
  }
  return { admin: { id: r.admin_id, email: r.email, displayName: r.display_name, role: r.role }, sessionId: id, token };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await getDbPool()?.query(`UPDATE admin_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
}

export async function revokeOtherSessions(client: PoolClient, adminId: string, keepSessionId: string | null): Promise<number> {
  const res = await client.query(
    `UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_id = $1 AND revoked_at IS NULL AND ($2::varchar IS NULL OR id <> $2)`,
    [adminId, keepSessionId],
  );
  return res.rowCount ?? 0;
}
